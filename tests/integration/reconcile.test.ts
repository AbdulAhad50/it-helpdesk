import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { startTestDb } from "./helpers";
import { createComplaint } from "@/lib/complaint-service";
import type { SheetSnapshot } from "@/lib/google-sheets";
import { getLastReconciliation, runReconciliation } from "@/lib/reconcile";
import { complaintsCollection } from "@/models/Complaint";
import { syncJobsCollection } from "@/models/SyncJob";

let db: Db;
let stop: () => Promise<void>;
beforeAll(async () => ({ db, stop } = await startTestDb()));
afterAll(async () => stop());
beforeEach(async () => {
  await Promise.all(["complaints", "syncjobs", "auditlogs", "settings"].map((c) => db.collection(c).deleteMany({})));
});

const input = { userName: "Ayesha Khan", department: "Sales", problemCategory: "Email / Outlook", problemDescription: "Outlook keeps asking for my password.", priority: "Normal" as const };
const make = async () => {
  const { complaintId } = await createComplaint(input, { correlationId: "c-12345" }, db);
  await syncJobsCollection(db).updateMany({ complaintId }, { $set: { status: "done" } }); // pretend the initial sync finished
  await complaintsCollection(db).updateOne({ complaintId }, { $set: { syncState: "synced", googleSheetSynced: true } });
  return complaintId;
};
const sheet = (rows: [string, string][], extra: Partial<SheetSnapshot> = {}): (() => Promise<SheetSnapshot>) => async () => ({
  rows: rows.map(([complaintId, status], i) => ({ rowNumber: i + 2, complaintId, status })),
  unidentifiedRows: [],
  ...extra,
});
const run = (readSheet: () => Promise<SheetSnapshot>, repair = false) => runReconciliation(db, { adminId: "admin-1", correlationId: "c-12345", repair }, { readSheet });
const doc = (id: string) => complaintsCollection(db).findOne({ complaintId: id });

describe("runReconciliation", () => {
  it("a matching sheet reports no problems and changes nothing", async () => {
    const a = await make();
    const r = await run(sheet([[a, "Pending"]]));
    expect(r).toMatchObject({ missing: 0, duplicates: 0, statusMismatches: 0, orphans: 0, consistent: 1, repairsQueued: 0 });
    expect(await doc(a)).toMatchObject({ syncState: "synced" });
  });

  it("flags missing rows, duplicate rows and status differences on the complaints concerned", async () => {
    const missing = await make();
    const dup = await make();
    const wrong = await make();
    await complaintsCollection(db).updateOne({ complaintId: wrong }, { $set: { status: "Resolved" } });
    const r = await run(sheet([[dup, "Pending"], [dup, "Pending"], [wrong, "Pending"], ["IT-20260101-ZZZZ", "Pending"]]));
    expect(r).toMatchObject({ missing: 1, duplicates: 1, statusMismatches: 1, orphans: 1 });
    expect(r.missingIds).toEqual([missing]);
    for (const id of [missing, dup, wrong]) expect(await doc(id)).toMatchObject({ syncState: "needs_reconciliation", googleSheetSynced: false });
  });

  it("without repair it queues nothing; with repair it queues exactly the safe fixes, once", async () => {
    const missing = await make();
    const wrong = await make();
    const dup = await make();
    await complaintsCollection(db).updateOne({ complaintId: wrong }, { $set: { status: "Resolved" } });
    const rows = sheet([[wrong, "Pending"], [dup, "Pending"], [dup, "Pending"], ["IT-20260101-ZZZZ", "Pending"]]);

    expect((await run(rows)).repairsQueued).toBe(0);
    const before = await syncJobsCollection(db).countDocuments();

    const r = await run(rows, true);
    expect(r.repairsQueued).toBe(2); // the missing row and the status fix; never the duplicate or the orphan
    const jobs = await syncJobsCollection(db).find({ eventId: { $regex: "reconcile" } }).toArray();
    expect(jobs.map((j) => `${j.type}:${j.complaintId}`).sort()).toEqual([`complaint.created:${missing}`, `complaint.updated:${wrong}`].sort());
    expect(jobs.every((j) => j.status === "pending")).toBe(true);
    expect(await syncJobsCollection(db).countDocuments()).toBe(before + 2);
  });

  it("skips complaints whose sync is still in flight (they'd look missing only because of timing)", async () => {
    const fresh = (await createComplaint(input, { correlationId: "c-12345" }, db)).complaintId; // its created job is still pending
    const r = await run(sheet([]));
    expect(r.skippedInFlight).toBe(1);
    expect(r.missing).toBe(0);
    expect(await doc(fresh)).toMatchObject({ syncState: "pending" });
  });

  it("clears a stale needs_reconciliation flag once the sheet is fixed", async () => {
    const a = await make();
    await run(sheet([]));
    expect(await doc(a)).toMatchObject({ syncState: "needs_reconciliation" });
    await run(sheet([[a, "Pending"]]));
    expect(await doc(a)).toMatchObject({ syncState: "synced", googleSheetSynced: true, syncError: null });
  });

  it("keeps the flag while a failed or dead sync job still exists for the complaint", async () => {
    const a = await make();
    await run(sheet([]));
    await syncJobsCollection(db).updateOne({ complaintId: a }, { $set: { status: "dead" } });
    await run(sheet([[a, "Pending"]]));
    expect(await doc(a)).toMatchObject({ syncState: "needs_reconciliation" });
  });

  it("records the last result, and a sheet read failure changes nothing", async () => {
    const a = await make();
    await run(sheet([[a, "Pending"]]));
    expect((await getLastReconciliation(db))!.result).toMatchObject({ consistent: 1, missing: 0 });

    await expect(run(async () => { throw new (await import("@/lib/google-sheets")).SheetsError("no_access", "no access"); }, true)).rejects.toMatchObject({ status: 422 });
    expect(await syncJobsCollection(db).countDocuments({ eventId: { $regex: "reconcile" } })).toBe(0);
  });
});
