import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { startTestDb } from "./helpers";
import { createComplaint, getConfirmation } from "@/lib/complaint-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { complaintsCollection } from "@/models/Complaint";
import { syncJobsCollection } from "@/models/SyncJob";
import { auditLogsCollection } from "@/models/AuditLog";
import * as idModule from "@/lib/complaint-id";

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => ({ db, stop } = await startTestDb()));
afterAll(async () => stop());
beforeEach(async () => {
  await Promise.all(["complaints", "syncjobs", "auditlogs", "ratelimits"].map((c) => db.collection(c).deleteMany({})));
  vi.restoreAllMocks();
});

const input = {
  userName: "Ayesha Khan",
  department: "Sales",
  problemCategory: "Email / Outlook",
  problemDescription: "Outlook keeps asking for my password every few minutes.",
  priority: "High" as const,
};
const ctx = { correlationId: "test-correlation-id" };

describe("createComplaint", () => {
  it("stores a Pending complaint with a server timestamp and no solve data", async () => {
    const before = Date.now();
    const created = await createComplaint(input, ctx, db);
    const doc = await complaintsCollection(db).findOne({ complaintId: created.complaintId });

    expect(doc).not.toBeNull();
    expect(doc!.status).toBe("Pending");
    expect(doc!.solvedAt).toBeNull();
    expect(doc!.solveDurationMinutes).toBeNull();
    expect(doc!.priorityRank).toBe(3);
    expect(doc!.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(doc!.receivedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(doc!.googleSheetSynced).toBe(false);
    expect(doc!.syncState).toBe("pending");
  });

  it("writes the outbox job and audit entry together with the complaint", async () => {
    const { complaintId } = await createComplaint(input, ctx, db);
    const job = await syncJobsCollection(db).findOne({ complaintId });
    expect(job).toMatchObject({ type: "complaint.created", status: "pending", attempts: 0, eventId: `complaint.created:${complaintId}` });
    const audit = await auditLogsCollection(db).findOne({ complaintId });
    expect(audit).toMatchObject({ action: "complaint.created", actor: "public", correlationId: "test-correlation-id" });
  });

  it("generates unique IDs under concurrent submissions", async () => {
    const results = await Promise.all(Array.from({ length: 60 }, () => createComplaint(input, ctx, db)));
    expect(new Set(results.map((r) => r.complaintId)).size).toBe(60);
    expect(await complaintsCollection(db).countDocuments()).toBe(60);
    expect(await syncJobsCollection(db).countDocuments()).toBe(60);
  });

  it("retries with a fresh ID after a duplicate-key collision, leaving no partial writes", async () => {
    const first = await createComplaint(input, ctx, db);
    const spy = vi.spyOn(idModule, "generateComplaintId");
    spy.mockReturnValueOnce(first.complaintId).mockReturnValueOnce(first.complaintId);
    const second = await createComplaint(input, ctx, db);

    expect(second.complaintId).not.toBe(first.complaintId);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await complaintsCollection(db).countDocuments()).toBe(2);
    expect(await syncJobsCollection(db).countDocuments()).toBe(2);
    expect(await auditLogsCollection(db).countDocuments()).toBe(2);
  });

  it("enforces unique complaintId at the database level", async () => {
    const { complaintId } = await createComplaint(input, ctx, db);
    const doc = await complaintsCollection(db).findOne({ complaintId });
    const { _id, ...rest } = doc!;
    void _id;
    await expect(complaintsCollection(db).insertOne(rest as never)).rejects.toMatchObject({ code: 11000 });
  });

  it("rejects invalid documents through the $jsonSchema validator", async () => {
    const { complaintId } = await createComplaint(input, ctx, db);
    await expect(
      complaintsCollection(db).updateOne({ complaintId }, { $set: { priority: "Urgent" as never } }),
    ).rejects.toMatchObject({ code: 121 });
    await expect(
      complaintsCollection(db).updateOne({ complaintId }, { $set: { status: "Closed" as never } }),
    ).rejects.toMatchObject({ code: 121 });
  });
});

describe("getConfirmation", () => {
  it("returns only limited, non-sensitive fields", async () => {
    const { complaintId } = await createComplaint({ ...input, contactNumber: "ext 204" }, ctx, db);
    const c = await getConfirmation(complaintId, db);
    expect(Object.keys(c!).sort()).toEqual(["complaintId", "priority", "problemCategory", "receivedAt", "status"]);
    expect(await getConfirmation("IT-20260101-AAAA", db)).toBeNull();
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit, then blocks until the window rolls over", async () => {
    const t0 = new Date("2026-10-18T10:00:00Z");
    const opts = { scope: "t", key: "k", limit: 3, windowSeconds: 900 };
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await checkRateLimit(db, { ...opts, now: t0 }));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false, false]);
    expect(r[3]!.retryAfterSeconds).toBeGreaterThan(0);
    expect((await checkRateLimit(db, { ...opts, now: new Date(t0.getTime() + 16 * 60_000) })).allowed).toBe(true);
  });
  it("keeps separate counters per key", async () => {
    const o = { scope: "t", limit: 1, windowSeconds: 900 };
    expect((await checkRateLimit(db, { ...o, key: "a" })).allowed).toBe(true);
    expect((await checkRateLimit(db, { ...o, key: "b" })).allowed).toBe(true);
    expect((await checkRateLimit(db, { ...o, key: "a" })).allowed).toBe(false);
  });
  it("counts correctly under concurrency", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(db, { scope: "c", key: "x", limit: 5, windowSeconds: 900 })));
    expect(res.filter((r) => r.allowed)).toHaveLength(5);
  });
});
