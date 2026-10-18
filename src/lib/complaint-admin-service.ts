import { ObjectId, type Db, type Filter, type Sort } from "mongodb";
import { ApiError } from "@/lib/api";
import { PRIORITY_RANK } from "@/lib/constants";
import {
  toDetail,
  toHistoryEntry,
  toListItem,
  toSyncJobView,
  type ComplaintDetail,
  type ComplaintListItem,
  type HistoryEntry,
  type SyncJobView,
} from "@/lib/complaint-view";
import { log } from "@/lib/logger";
import { karachiMidnightUtc } from "@/lib/range";
import { SYNC_MAX_ATTEMPTS } from "@/lib/complaint-service";
import type { ComplaintEditInput, ListQuery, ResolveInput } from "@/lib/validation-admin";
import type { FormOptions } from "@/lib/validation";
import { adminsCollection } from "@/models/Admin";
import { auditLogsCollection, type AuditChange } from "@/models/AuditLog";
import { complaintsCollection, type ComplaintDoc } from "@/models/Complaint";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

const DAY_MS = 86_400_000;

// ── Listing ────────────────────────────────────────────────────────────────

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turns validated list parameters into a MongoDB filter. User text is always escaped, never interpreted. */
export function buildListFilter(q: ListQuery): Filter<ComplaintDoc> {
  const f: Filter<ComplaintDoc> = {};
  if (q.status) f.status = q.status;
  if (q.priority) f.priority = q.priority;
  if (q.department) f.department = q.department;
  if (q.category) f.problemCategory = q.category;

  const received: { $gte?: Date; $lt?: Date } = {};
  const from = q.from ? karachiMidnightUtc(q.from) : null;
  const to = q.to ? karachiMidnightUtc(q.to) : null;
  if (from) received.$gte = from;
  if (to) received.$lt = new Date(to.getTime() + DAY_MS); // the whole end day is included
  if (received.$gte || received.$lt) f.receivedAt = received;

  if (q.q) {
    f.$or = [
      { userName: { $regex: escapeRegex(q.q), $options: "i" } },
      { complaintId: { $regex: escapeRegex(q.q.toUpperCase()) } },
    ];
  }
  return f;
}

export function buildListSort(q: ListQuery): Sort {
  const d = q.dir === "asc" ? 1 : -1;
  // Every sort ends in unique tie-breakers so pagination never repeats or skips rows.
  if (q.sort === "priority") return { priorityRank: d, receivedAt: -1, _id: -1 };
  if (q.sort === "status") return { status: d, receivedAt: -1, _id: -1 };
  return { receivedAt: d, _id: d };
}

export interface ComplaintPage {
  items: ComplaintListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listComplaints(db: Db, q: ListQuery): Promise<ComplaintPage> {
  const filter = buildListFilter(q);
  const col = complaintsCollection(db);
  const [total, docs] = await Promise.all([
    col.countDocuments(filter),
    col
      .find(filter, { projection: { contactNumber: 0 } })
      .sort(buildListSort(q))
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .toArray(),
  ]);
  return { items: docs.map(toListItem), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

// ── Detail ─────────────────────────────────────────────────────────────────

async function adminNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const valid = [...new Set(ids)].filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i));
  const rows = valid.length ? await adminsCollection(db).find({ _id: { $in: valid } }, { projection: { name: 1 } }).toArray() : [];
  return new Map(rows.map((r) => [r._id.toHexString(), r.name]));
}

export interface ComplaintFull {
  complaint: ComplaintDetail;
  history: HistoryEntry[];
  syncJobs: SyncJobView[];
}

export async function getComplaintFull(db: Db, complaintId: string): Promise<ComplaintFull | null> {
  const c = await complaintsCollection(db).findOne({ complaintId });
  if (!c) return null;
  const [audit, jobs] = await Promise.all([
    auditLogsCollection(db).find({ complaintId }).sort({ createdAt: -1, _id: -1 }).toArray(),
    syncJobsCollection(db).find({ complaintId }).sort({ createdAt: 1 }).toArray(),
  ]);
  const names = await adminNames(db, [...audit.map((a) => a.actor), ...(c.resolvedBy ? [c.resolvedBy] : [])]);
  const actorName = (actor: string) =>
    actor === "public" ? "Employee" : actor === "system" ? "System" : (names.get(actor) ?? "Unknown administrator");
  return {
    complaint: toDetail(c, c.resolvedBy ? (names.get(c.resolvedBy) ?? "Unknown administrator") : null),
    history: audit.map((a) => toHistoryEntry(a, actorName(a.actor))),
    syncJobs: jobs.map(toSyncJobView),
  };
}

export async function getAuditPage(db: Db, opts: { complaintId?: string; page: number; pageSize: number }) {
  const filter = opts.complaintId ? { complaintId: opts.complaintId } : {};
  const col = auditLogsCollection(db);
  const [total, rows] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter).sort({ createdAt: -1, _id: -1 }).skip((opts.page - 1) * opts.pageSize).limit(opts.pageSize).toArray(),
  ]);
  const names = await adminNames(db, rows.map((r) => r.actor));
  const actorName = (a: string) => (a === "public" ? "Employee" : a === "system" ? "System" : (names.get(a) ?? "Unknown administrator"));
  return {
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    entries: rows.map((r) => ({ complaintId: r.complaintId, ...toHistoryEntry(r, actorName(r.actor)) })),
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

const clip = (v: unknown) => (typeof v === "string" && v.length > 500 ? `${v.slice(0, 499)}…` : v);
const OPEN_STATES = ["synced", "pending"];

function newJob(complaintId: string, type: SyncJobDoc["type"], version: number, now: Date): SyncJobDoc {
  return {
    _id: new ObjectId(),
    eventId: `${type}:${complaintId}:${version}`, // unique per change, so retries are idempotent
    type,
    complaintId,
    status: "pending",
    attempts: 0,
    maxAttempts: SYNC_MAX_ATTEMPTS,
    nextAttemptAt: now,
    lockedUntil: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

const notFound = () => new ApiError(404, "NOT_FOUND", "No complaint found with that ID.");
const stale = () =>
  new ApiError(409, "STALE_VERSION", "Someone else changed this complaint while you were editing. Reload to see their changes, then try again.");

export interface WriteResult {
  changed: boolean;
  version: number;
  /** Sync job to dispatch once the transaction has committed. */
  eventId: string | null;
}

/**
 * Edit allowed fields. Optimistic concurrency: the caller states which version it saw. Everything
 * (the update, the audit entry and the sync job) commits together or not at all.
 * Never touches: complaintId, names, description, receivedAt, status, solvedAt, duration, resolvedBy.
 */
export async function updateComplaint(
  db: Db,
  args: { complaintId: string; adminId: string; input: ComplaintEditInput; options: FormOptions; correlationId: string },
): Promise<WriteResult> {
  const { complaintId, adminId, input, options, correlationId } = args;
  const col = complaintsCollection(db);

  return db.client.withSession((session) =>
    session.withTransaction(async () => {
      const before = await col.findOne({ complaintId }, { session });
      if (!before) throw notFound();
      if (before.version !== input.version) throw stale();

      const set: Partial<ComplaintDoc> = {};
      const changes: AuditChange[] = [];
      const note = (field: keyof ComplaintDoc, from: unknown, to: unknown) => changes.push({ field, from: clip(from), to: clip(to) });

      if (input.priority !== undefined && input.priority !== before.priority) {
        set.priority = input.priority;
        set.priorityRank = PRIORITY_RANK[input.priority];
        note("priority", before.priority, input.priority);
      }
      // A correction must use a configured value; leaving an old, since-removed value alone is fine.
      if (input.department !== undefined && input.department !== before.department) {
        if (!options.departments.includes(input.department)) {
          throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: { department: ["Choose a department from the list."] } });
        }
        set.department = input.department;
        note("department", before.department, input.department);
      }
      if (input.problemCategory !== undefined && input.problemCategory !== before.problemCategory) {
        if (!options.categories.includes(input.problemCategory)) {
          throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: { problemCategory: ["Choose a category from the list."] } });
        }
        set.problemCategory = input.problemCategory;
        note("problemCategory", before.problemCategory, input.problemCategory);
      }
      if (input.workStuckReason !== undefined && input.workStuckReason !== before.workStuckReason) {
        set.workStuckReason = input.workStuckReason;
        note("workStuckReason", before.workStuckReason, input.workStuckReason);
      }
      if (input.resolutionNotes !== undefined && input.resolutionNotes !== before.resolutionNotes) {
        set.resolutionNotes = input.resolutionNotes;
        note("resolutionNotes", before.resolutionNotes, input.resolutionNotes);
      }

      if (changes.length === 0) return { changed: false, version: before.version, eventId: null };

      const now = new Date();
      const version = before.version + 1;
      const keepState = !OPEN_STATES.includes(before.syncState); // never hide a failed / reconciliation flag
      const res = await col.updateOne(
        { _id: before._id, version: before.version },
        {
          $set: {
            ...set,
            updatedAt: now,
            version,
            googleSheetSynced: false,
            syncState: keepState ? before.syncState : "pending",
            syncError: keepState ? before.syncError : null,
          },
        },
        { session },
      );
      if (res.matchedCount === 0) throw stale();

      const job = newJob(complaintId, "complaint.updated", version, now);
      await syncJobsCollection(db).insertOne(job, { session });
      await auditLogsCollection(db).insertOne(
        { _id: new ObjectId(), complaintId, action: "complaint.updated", actor: adminId, changes, correlationId, createdAt: now },
        { session },
      );
      log("info", "complaint.updated", { complaintId, adminId, correlationId, fields: changes.map((c) => c.field) });
      return { changed: true, version, eventId: job.eventId };
    }),
  );
}

/**
 * Resolve exactly one Pending complaint. The status check and the write are ONE atomic MongoDB
 * operation: two administrators clicking at once cannot both succeed, and a resolved complaint can
 * never get a second resolution time. solvedAt and the duration come from the database clock
 * ($$NOW) in a single instant, so they always agree with each other.
 */
export async function resolveComplaint(
  db: Db,
  args: { complaintId: string; adminId: string; input: ResolveInput; correlationId: string },
): Promise<WriteResult & { solvedAt: Date; solveDurationMinutes: number }> {
  const { complaintId, adminId, input, correlationId } = args;
  const col = complaintsCollection(db);

  return db.client.withSession((session) =>
    session.withTransaction(async () => {
      const before = await col.findOne({ complaintId }, { session });
      if (!before) throw notFound();
      if (before.status === "Resolved") {
        throw new ApiError(409, "ALREADY_RESOLVED", "This complaint has already been resolved.");
      }

      // $literal: admin text must never be read as a field path or operator (e.g. a note starting with "$").
      const textOr = (value: string | null | undefined, field: string) => (value !== undefined ? { $literal: value } : `$${field}`);
      const keepState = !OPEN_STATES.includes(before.syncState);

      const after = await col.findOneAndUpdate(
        { _id: before._id, status: "Pending" },
        [
          {
            $set: {
              status: "Resolved",
              solvedAt: "$$NOW",
              // Same rule as computeSolveDurationMinutes(): nearest minute, halves up, never negative.
              solveDurationMinutes: {
                $toInt: { $max: [0, { $floor: { $add: [{ $divide: [{ $subtract: ["$$NOW", "$receivedAt"] }, 60000] }, 0.5] } }] },
              },
              resolvedBy: { $literal: adminId },
              workStuckReason: textOr(input.workStuckReason, "workStuckReason"),
              resolutionNotes: textOr(input.resolutionNotes, "resolutionNotes"),
              updatedAt: "$$NOW",
              version: { $add: ["$version", 1] },
              googleSheetSynced: false,
              syncState: { $literal: keepState ? before.syncState : "pending" },
              syncError: { $literal: keepState ? before.syncError : null },
            },
          },
        ],
        { returnDocument: "after", session },
      );
      if (!after || !after.solvedAt || after.solveDurationMinutes === null) {
        // Someone resolved it between our read and write.
        throw new ApiError(409, "ALREADY_RESOLVED", "This complaint has already been resolved.");
      }

      const changes: AuditChange[] = [
        { field: "status", from: "Pending", to: "Resolved" },
        { field: "solvedAt", from: null, to: after.solvedAt },
        { field: "solveDurationMinutes", from: null, to: after.solveDurationMinutes },
      ];
      if (after.workStuckReason !== before.workStuckReason) changes.push({ field: "workStuckReason", from: clip(before.workStuckReason), to: clip(after.workStuckReason) });
      if (after.resolutionNotes !== before.resolutionNotes) changes.push({ field: "resolutionNotes", from: clip(before.resolutionNotes), to: clip(after.resolutionNotes) });

      const job = newJob(complaintId, "complaint.resolved", after.version, after.solvedAt);
      await syncJobsCollection(db).insertOne(job, { session });
      await auditLogsCollection(db).insertOne(
        { _id: new ObjectId(), complaintId, action: "complaint.resolved", actor: adminId, changes, correlationId, createdAt: after.solvedAt },
        { session },
      );
      log("info", "complaint.resolved", { complaintId, adminId, correlationId, durationMinutes: after.solveDurationMinutes });
      return { changed: true, version: after.version, eventId: job.eventId, solvedAt: after.solvedAt, solveDurationMinutes: after.solveDurationMinutes };
    }),
  );
}

/** Put this complaint's failed or exhausted sync jobs back in the queue. Returns the event IDs, oldest first. */
export async function retryComplaintSync(
  db: Db,
  args: { complaintId: string; adminId: string; correlationId: string },
): Promise<{ eventIds: string[] }> {
  const { complaintId, adminId, correlationId } = args;
  return db.client.withSession((session) =>
    session.withTransaction(async () => {
      const complaint = await complaintsCollection(db).findOne({ complaintId }, { session });
      if (!complaint) throw notFound();
      const jobs = syncJobsCollection(db);
      const stuck = await jobs.find({ complaintId, status: { $in: ["failed", "dead"] } }, { session }).sort({ createdAt: 1 }).toArray();
      if (stuck.length === 0) throw new ApiError(409, "NOTHING_TO_RETRY", "There is nothing to retry for this complaint.");

      const now = new Date();
      await jobs.updateMany(
        { _id: { $in: stuck.map((j) => j._id) } },
        { $set: { status: "pending", attempts: 0, nextAttemptAt: now, lockedUntil: null, lastError: null, updatedAt: now } },
        { session },
      );
      await complaintsCollection(db).updateOne(
        { complaintId },
        { $set: { syncState: "pending", syncError: null } }, // sync status only: no updatedAt/version change
        { session },
      );
      await auditLogsCollection(db).insertOne(
        { _id: new ObjectId(), complaintId, action: "sync.retried", actor: adminId, changes: [], correlationId, createdAt: now },
        { session },
      );
      return { eventIds: stuck.map((j) => j.eventId) };
    }),
  );
}
