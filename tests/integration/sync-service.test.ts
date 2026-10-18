import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { startTestDb } from "./helpers";
import { createComplaint } from "@/lib/complaint-service";
import type { N8nResult } from "@/lib/n8n";
import type { SyncEvent } from "@/lib/sheet-row";
import { SYNC_LEASE_MS, claimJob, dispatchJobByEventId, getQueueSummary, processJob, runDueJobs } from "@/lib/sync-service";
import { complaintsCollection } from "@/models/Complaint";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

let db: Db;
let stop: () => Promise<void>;
beforeAll(async () => ({ db, stop } = await startTestDb()));
afterAll(async () => stop());
beforeEach(async () => {
  await Promise.all(["complaints", "syncjobs", "auditlogs", "admins"].map((c) => db.collection(c).deleteMany({})));
});

const input = { userName: "Ayesha Khan", department: "Sales", problemCategory: "Email / Outlook", problemDescription: "Outlook keeps asking for my password.", priority: "High" as const };
const ctx = { correlationId: "corr-1234" };
const ok = (event: SyncEvent): N8nResult => ({ kind: "success", result: event.eventType === "complaint.created" ? "appended" : "updated", rowNumber: 2 });

async function newComplaint() {
  const { complaintId } = await createComplaint(input, ctx, db);
  return { complaintId, eventId: `complaint.created:${complaintId}` };
}
const jobOf = (eventId: string) => syncJobsCollection(db).findOne({ eventId }) as Promise<SyncJobDoc>;
const complaintOf = (complaintId: string) => complaintsCollection(db).findOne({ complaintId });

async function addJob(complaintId: string, type: SyncJobDoc["type"], suffix: string): Promise<SyncJobDoc> {
  const now = new Date();
  const job: SyncJobDoc = {
    _id: new ObjectId(), eventId: `${type}:${complaintId}:${suffix}`, type, complaintId, status: "pending", attempts: 0,
    maxAttempts: 8, nextAttemptAt: now, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now, completedAt: null,
  };
  await syncJobsCollection(db).insertOne(job);
  return job;
}

describe("dispatching a new complaint", () => {
  it("success: job done, complaint marked synced, and the payload is the current row", async () => {
    const { complaintId, eventId } = await newComplaint();
    const send = vi.fn(async (e: SyncEvent) => ok(e));
    expect(await dispatchJobByEventId(db, eventId, { send })).toBe("done");

    expect(send.mock.calls[0]![0]).toMatchObject({ eventId, eventType: "complaint.created", complaintId });
    expect(send.mock.calls[0]![0].row.Status).toBe("Pending");
    expect(await jobOf(eventId)).toMatchObject({ status: "done", attempts: 1, lockedUntil: null });
    expect(await complaintOf(complaintId)).toMatchObject({ googleSheetSynced: true, syncState: "synced", syncError: null });
  });

  it("not configured: stays pending, consumes no attempt, and says so honestly", async () => {
    const { complaintId, eventId } = await newComplaint();
    const outcome = await dispatchJobByEventId(db, eventId, { send: async () => ({ kind: "not_configured", message: "Awaiting configuration." }) });
    expect(outcome).toBe("not_configured");
    expect(await jobOf(eventId)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await complaintOf(complaintId)).toMatchObject({ googleSheetSynced: false, syncState: "pending", syncError: "Awaiting configuration." });
  });

  it("temporary failure: complaint stays stored, job is rescheduled in the future", async () => {
    const { complaintId, eventId } = await newComplaint();
    const before = Date.now();
    expect(await dispatchJobByEventId(db, eventId, { send: async () => ({ kind: "retryable", message: "Couldn't reach n8n." }) })).toBe("retry");
    const job = await jobOf(eventId);
    expect(job).toMatchObject({ status: "pending", attempts: 1, lastError: "Couldn't reach n8n." });
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(before + 25_000);
    expect(await complaintOf(complaintId)).toMatchObject({ googleSheetSynced: false, syncState: "pending" });
  });

  it("is idempotent: dispatching again after success does nothing", async () => {
    const { eventId } = await newComplaint();
    const send = vi.fn(async (e: SyncEvent) => ok(e));
    await dispatchJobByEventId(db, eventId, { send });
    expect(await dispatchJobByEventId(db, eventId, { send })).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("retries", () => {
  it("exhausting every attempt ends in 'dead' and a failed sync state", async () => {
    const { complaintId, eventId } = await newComplaint();
    await syncJobsCollection(db).updateOne({ eventId }, { $set: { maxAttempts: 3 } });
    const send = async (): Promise<N8nResult> => ({ kind: "retryable", message: "down" });
    for (let i = 0; i < 3; i++) {
      await syncJobsCollection(db).updateOne({ eventId }, { $set: { nextAttemptAt: new Date(0) } }); // make it due now
      await dispatchJobByEventId(db, eventId, { send });
    }
    expect(await jobOf(eventId)).toMatchObject({ status: "dead", attempts: 3 });
    expect(await complaintOf(complaintId)).toMatchObject({ syncState: "failed", googleSheetSynced: false });
    expect(await getQueueSummary(db)).toMatchObject({ dead: 1, needsAttention: 1 });
  });

  it("a later success after failures clears the error and marks the complaint synced", async () => {
    const { complaintId, eventId } = await newComplaint();
    await dispatchJobByEventId(db, eventId, { send: async () => ({ kind: "retryable", message: "down" }) });
    await syncJobsCollection(db).updateOne({ eventId }, { $set: { nextAttemptAt: new Date(0) } });
    expect(await dispatchJobByEventId(db, eventId, { send: async (e) => ok(e) })).toBe("done");
    expect(await complaintOf(complaintId)).toMatchObject({ syncState: "synced", syncError: null, googleSheetSynced: true });
  });

  it("runDueJobs processes several due jobs and leaves not-yet-due ones alone", async () => {
    const a = await newComplaint();
    const b = await newComplaint();
    const c = await newComplaint();
    await syncJobsCollection(db).updateOne({ eventId: c.eventId }, { $set: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    const summary = await runDueJobs(db, { send: async (e) => ok(e) });
    expect(summary).toMatchObject({ claimed: 2, done: 2 });
    expect((await jobOf(a.eventId)).status).toBe("done");
    expect((await jobOf(b.eventId)).status).toBe("done");
    expect((await jobOf(c.eventId)).status).toBe("pending");
  });
});

describe("integrity problems", () => {
  it("row_missing is flagged for reconciliation and is NOT retried", async () => {
    const { complaintId, eventId } = await newComplaint();
    await dispatchJobByEventId(db, eventId, { send: async (e) => ok(e) });
    const resolved = await addJob(complaintId, "complaint.resolved", "2");
    const claimed = (await claimJob(db, new Date(), resolved.eventId))!;
    const outcome = await processJob(db, claimed, { send: async () => ({ kind: "integrity", code: "row_missing", message: "No sheet row has this Complaint ID." }) });
    expect(outcome).toBe("failed");
    expect(await jobOf(resolved.eventId)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await complaintOf(complaintId)).toMatchObject({ syncState: "needs_reconciliation" });
    expect(await claimJob(db, new Date(Date.now() + 3_600_000), resolved.eventId)).toBeNull(); // never auto-claimed again
  });
});

describe("ordering and concurrency", () => {
  it("an update job waits until the create job is done (no update against a missing row)", async () => {
    const { complaintId, eventId } = await newComplaint();
    const update = await addJob(complaintId, "complaint.updated", "2");
    const send = vi.fn(async (e: SyncEvent) => ok(e));

    const claimed = (await claimJob(db, new Date(), update.eventId))!;
    expect(await processJob(db, claimed, { send })).toBe("deferred");
    expect(send).not.toHaveBeenCalled();
    expect((await jobOf(update.eventId)).status).toBe("pending");

    await dispatchJobByEventId(db, eventId, { send }); // create goes first
    await syncJobsCollection(db).updateOne({ eventId: update.eventId }, { $set: { nextAttemptAt: new Date(0) } });
    expect(await dispatchJobByEventId(db, update.eventId, { send })).toBe("done");
    expect(send.mock.calls.map((c) => c[0].eventType)).toEqual(["complaint.created", "complaint.updated"]);
  });

  it("does not mark the complaint synced while another job is still open", async () => {
    const { complaintId, eventId } = await newComplaint();
    await addJob(complaintId, "complaint.updated", "2");
    await dispatchJobByEventId(db, eventId, { send: async (e) => ok(e) });
    expect(await complaintOf(complaintId)).toMatchObject({ googleSheetSynced: false, syncState: "pending" });
  });

  it("only one of many simultaneous claimers gets a given job", async () => {
    const { eventId } = await newComplaint();
    const claims = await Promise.all(Array.from({ length: 10 }, () => claimJob(db, new Date(), eventId)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("a job whose runner died is reclaimed after its lease expires, not before", async () => {
    const { eventId } = await newComplaint();
    const t0 = new Date();
    expect(await claimJob(db, t0, eventId)).not.toBeNull();
    expect(await claimJob(db, new Date(t0.getTime() + SYNC_LEASE_MS - 1000), eventId)).toBeNull();
    expect(await claimJob(db, new Date(t0.getTime() + SYNC_LEASE_MS + 1000), eventId)).not.toBeNull();
  });

  it("a complaint that no longer exists orphans its job instead of crashing the runner", async () => {
    const { complaintId, eventId } = await newComplaint();
    await complaintsCollection(db).deleteOne({ complaintId });
    const job = (await claimJob(db, new Date(), eventId))!;
    expect(await processJob(db, job)).toBe("orphaned");
    expect((await jobOf(eventId)).status).toBe("dead");
  });
});
