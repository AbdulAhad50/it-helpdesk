import { ObjectId, type Db } from "mongodb";
import { log } from "@/lib/logger";
import { sendToN8n, type N8nResult } from "@/lib/n8n";
import { buildSyncEvent, type SyncEvent } from "@/lib/sheet-row";
import { adminsCollection } from "@/models/Admin";
import { complaintsCollection, type ComplaintDoc } from "@/models/Complaint";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

export const SYNC_LEASE_MS = 60_000;
export const DEFER_MS = 30_000;
export const NOT_CONFIGURED_RETRY_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/** 30s, 1m, 2m, 4m, 8m, 16m, 32m, then capped at 1h, plus up to 20% jitter. Bounded on purpose. */
export function backoffMs(attemptsSoFar: number, rand: () => number = Math.random): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attemptsSoFar - 1), BACKOFF_CAP_MS);
  return Math.round(base * (1 + rand() * 0.2));
}

/** Stored errors are for administrators, so strip URLs and anything token-shaped, and keep them short. */
export function sanitizeSyncError(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export type JobOutcome = "done" | "retry" | "failed" | "dead" | "not_configured";

export interface Transition {
  outcome: JobOutcome;
  job: Partial<SyncJobDoc>;
  /** Sync-status fields to set on the complaint, or null to leave it alone. Never touches updatedAt/version. */
  complaint: Partial<Pick<ComplaintDoc, "syncState" | "syncError" | "googleSheetSynced" | "googleSheetSyncedAt">> | null;
}

/**
 * Pure decision: given what n8n said, what happens to the job and the complaint's sync status?
 * `otherOpenJobs` = this complaint's jobs (other than this one) that are not yet "done".
 */
export function planTransition(
  job: Pick<SyncJobDoc, "attempts" | "maxAttempts">,
  result: N8nResult,
  now: Date,
  otherOpenJobs: number,
  rand: () => number = Math.random,
): Transition {
  const attempts = job.attempts + 1;
  const base = { lockedUntil: null, updatedAt: now } as const;

  switch (result.kind) {
    case "success":
      return {
        outcome: "done",
        job: { ...base, status: "done", attempts, lastError: null, completedAt: now },
        // Only claim "synced" when nothing else is still waiting to be written to the sheet.
        complaint:
          otherOpenJobs === 0
            ? { syncState: "synced", syncError: null, googleSheetSynced: true, googleSheetSyncedAt: now }
            : null,
      };

    case "retryable": {
      const message = sanitizeSyncError(result.message);
      if (attempts >= job.maxAttempts) {
        return {
          outcome: "dead",
          job: { ...base, status: "dead", attempts, lastError: message },
          complaint: { syncState: "failed", syncError: message },
        };
      }
      return {
        outcome: "retry",
        job: { ...base, status: "pending", attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, rand)) },
        complaint: { syncState: "pending", syncError: message },
      };
    }

    case "integrity": {
      const message = sanitizeSyncError(result.message);
      return {
        outcome: "failed",
        job: { ...base, status: "failed", attempts, lastError: message },
        complaint: { syncState: "needs_reconciliation", syncError: message },
      };
    }

    case "rejected": {
      const message = sanitizeSyncError(result.message);
      return {
        outcome: "dead",
        job: { ...base, status: "dead", attempts, lastError: message },
        complaint: { syncState: "failed", syncError: message },
      };
    }

    case "not_configured": {
      const message = sanitizeSyncError(result.message);
      return {
        outcome: "not_configured",
        // Not the job's fault, so no attempt is consumed. Check again later.
        job: { ...base, status: "pending", lastError: message, nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS) },
        complaint: { syncState: "pending", syncError: message },
      };
    }
  }
}

export interface SyncDeps {
  send?: (event: SyncEvent) => Promise<N8nResult>;
  now?: () => Date;
}

const claimFilter = (now: Date) => ({
  status: { $in: ["pending", "processing"] as SyncJobDoc["status"][] },
  nextAttemptAt: { $lte: now },
  $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
});

/** Atomically lease one due job (optionally a specific one). Two runners can never claim the same job. */
export async function claimJob(db: Db, now: Date, eventId?: string): Promise<SyncJobDoc | null> {
  return syncJobsCollection(db).findOneAndUpdate(
    { ...claimFilter(now), ...(eventId ? { eventId } : {}) },
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + SYNC_LEASE_MS), updatedAt: now } },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: "after" },
  );
}

async function resolvedByLabel(db: Db, resolvedBy: string | null): Promise<string | null> {
  if (!resolvedBy || !ObjectId.isValid(resolvedBy)) return resolvedBy;
  const admin = await adminsCollection(db).findOne({ _id: new ObjectId(resolvedBy) }, { projection: { name: 1 } });
  return admin?.name ?? "Unknown administrator";
}

/** Send one leased job to n8n and record exactly what happened. */
export async function processJob(db: Db, job: SyncJobDoc, deps: SyncDeps = {}): Promise<JobOutcome | "deferred" | "orphaned"> {
  const now = deps.now?.() ?? new Date();
  const jobs = syncJobsCollection(db);
  const complaints = complaintsCollection(db);

  const complaint = await complaints.findOne({ complaintId: job.complaintId });
  if (!complaint) {
    await jobs.updateOne(
      { _id: job._id },
      { $set: { status: "dead", lockedUntil: null, lastError: "The complaint no longer exists.", updatedAt: now } },
    );
    return "orphaned";
  }

  // A row can only be updated after it has been created. Wait for the create job to finish first.
  if (job.type !== "complaint.created") {
    const createPending = await jobs.countDocuments({ complaintId: job.complaintId, type: "complaint.created", status: { $ne: "done" } });
    if (createPending > 0) {
      await jobs.updateOne(
        { _id: job._id },
        { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(now.getTime() + DEFER_MS), updatedAt: now } },
      );
      return "deferred";
    }
  }

  // The payload is rebuilt from MongoDB now, so a retry always sends the latest truth.
  const event = buildSyncEvent(job, complaint, await resolvedByLabel(db, complaint.resolvedBy), now);
  const result = await (deps.send ?? sendToN8n)(event);

  const otherOpenJobs = await jobs.countDocuments({
    complaintId: job.complaintId,
    _id: { $ne: job._id },
    status: { $ne: "done" },
  });
  const plan = planTransition(job, result, now, otherOpenJobs);

  await jobs.updateOne({ _id: job._id }, { $set: plan.job });
  if (plan.complaint) await complaints.updateOne({ complaintId: job.complaintId }, { $set: plan.complaint });

  log(plan.outcome === "done" ? "info" : "warn", "sync.job_processed", {
    eventId: job.eventId,
    complaintId: job.complaintId,
    outcome: plan.outcome,
    attempts: plan.job.attempts ?? job.attempts,
  });
  return plan.outcome;
}

/** Try to sync one specific event right now (used straight after a complaint is stored). */
export async function dispatchJobByEventId(db: Db, eventId: string, deps: SyncDeps = {}) {
  const job = await claimJob(db, deps.now?.() ?? new Date(), eventId);
  return job ? processJob(db, job, deps) : null;
}

export interface RunSummary {
  claimed: number;
  done: number;
  retry: number;
  failed: number;
  dead: number;
  deferred: number;
  notConfigured: number;
}

/** Process due jobs one at a time, within a count and time budget. */
export async function runDueJobs(
  db: Db,
  opts: { max?: number; budgetMs?: number } & SyncDeps = {},
): Promise<RunSummary> {
  const max = opts.max ?? 10;
  const started = Date.now();
  const summary: RunSummary = { claimed: 0, done: 0, retry: 0, failed: 0, dead: 0, deferred: 0, notConfigured: 0 };

  while (summary.claimed < max && Date.now() - started < (opts.budgetMs ?? 25_000)) {
    const job = await claimJob(db, opts.now?.() ?? new Date());
    if (!job) break;
    summary.claimed++;
    try {
      const outcome = await processJob(db, job, opts);
      if (outcome === "done") summary.done++;
      else if (outcome === "retry") summary.retry++;
      else if (outcome === "failed") summary.failed++;
      else if (outcome === "dead" || outcome === "orphaned") summary.dead++;
      else if (outcome === "deferred") summary.deferred++;
      else summary.notConfigured++;
    } catch (err) {
      // Unexpected crash: release the lease so the job is retried, and keep going.
      log("error", "sync.job_crashed", { eventId: job.eventId, err: { message: (err as Error).message } });
      await syncJobsCollection(db).updateOne(
        { _id: job._id },
        { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(Date.now() + DEFER_MS), lastError: "Internal error while syncing.", updatedAt: new Date() } },
      );
    }
  }
  return summary;
}

export interface QueueSummary {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  dead: number;
  needsAttention: number;
}

export async function getQueueSummary(db: Db): Promise<QueueSummary> {
  const rows = await syncJobsCollection(db).aggregate<{ _id: SyncJobDoc["status"]; n: number }>([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]).toArray();
  const count = (s: SyncJobDoc["status"]) => rows.find((r) => r._id === s)?.n ?? 0;
  return {
    pending: count("pending"),
    processing: count("processing"),
    done: count("done"),
    failed: count("failed"),
    dead: count("dead"),
    needsAttention: count("failed") + count("dead"),
  };
}
