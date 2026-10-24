import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { startTestDb } from "./helpers";
import { ApiError } from "@/lib/api";
import * as idModule from "@/lib/complaint-id";
import { dispatchJobByEventId, claimJob, processJob } from "@/lib/sync-service";
import { getOutlets, getFormOptions, saveFormOptions } from "@/lib/settings-service";
import { acceptTransfer, countInTransit, createTransfer, getTransferConfirmation, getTransferFull, listTransfers, retryTransferSync } from "@/lib/transfer-service";
import type { TransferSyncEvent } from "@/lib/sheet-row";
import { adminsCollection } from "@/models/Admin";
import { transfersCollection } from "@/models/ItemTransfer";
import { syncJobsCollection } from "@/models/SyncJob";
import { parseTransferListQuery } from "@/lib/validation-transfer";

let db: Db;
let stop: () => Promise<void>;
const ADMIN = new ObjectId();
const ADMIN_ID = ADMIN.toHexString();

beforeAll(async () => ({ db, stop } = await startTestDb()));
afterAll(async () => stop());
beforeEach(async () => {
  await Promise.all(["itemtransfers", "syncjobs", "admins", "settings"].map((c) => db.collection(c).deleteMany({})));
  const now = new Date();
  await adminsCollection(db).insertOne({ _id: ADMIN, email: "it@company.com", name: "IT Admin", passwordHash: "x", disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now });
  vi.restoreAllMocks();
});

const fields = (over: Record<string, unknown> = {}) => ({ name: "Ayesha Khan", email: "ayesha@example.com", contact: "0300 1234567", outlet: "Malir", description: "Receipt printer with a faulty cutter.", ...over });
const make = (over: Record<string, unknown> = {}, direction: "to_it" | "from_it" = "to_it", source: "public" | "admin" = "public") =>
  createTransfer(db, { fields: fields(over), direction, source, actorId: source === "public" ? "public" : ADMIN_ID, correlationId: "corr-12345" });
const get = (id: string) => transfersCollection(db).findOne({ transferId: id });
const accept = (transferId: string, notes?: string | null) => acceptTransfer(db, { transferId, adminId: ADMIN_ID, notes, correlationId: "corr-12345" });
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.status : e;
  }
};
const q = (o: Record<string, string> = {}) => {
  const r = parseTransferListQuery(o);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.query;
};

describe("createTransfer", () => {
  it("stores an In transit record with a server date, history, and an outbox job, all together", async () => {
    const before = Date.now();
    const { transferId, eventId } = await make();
    const doc = (await get(transferId))!;
    expect(doc).toMatchObject({ direction: "to_it", source: "public", status: "In transit", createdBy: "public", version: 1, receivedAt: null, receivedBy: null, syncState: "pending", googleSheetSynced: false });
    expect(doc.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(doc.history).toHaveLength(1);
    expect(doc.history[0]).toMatchObject({ action: "created", actor: "public" });
    expect(await syncJobsCollection(db).findOne({ eventId })).toMatchObject({ type: "transfer.created", complaintId: transferId, status: "pending", eventId: `transfer.created:${transferId}` });
  });
  it("records an admin-created outbound item with the administrator as actor", async () => {
    const { transferId } = await make({ email: undefined, contact: undefined }, "from_it", "admin");
    expect(await get(transferId)).toMatchObject({ direction: "from_it", source: "admin", createdBy: ADMIN_ID, email: null, contact: null });
  });
  it("generates unique IDs under concurrent submissions", async () => {
    const r = await Promise.all(Array.from({ length: 40 }, () => make()));
    expect(new Set(r.map((x) => x.transferId)).size).toBe(40);
    expect(await syncJobsCollection(db).countDocuments({ type: "transfer.created" })).toBe(40);
  });
  it("retries with a fresh ID after a collision and leaves no partial writes", async () => {
    const first = await make();
    const spy = vi.spyOn(idModule, "generateTransferId");
    spy.mockReturnValueOnce(first.transferId).mockReturnValueOnce(first.transferId);
    const second = await make();
    expect(second.transferId).not.toBe(first.transferId);
    expect(await transfersCollection(db).countDocuments()).toBe(2);
    expect(await syncJobsCollection(db).countDocuments()).toBe(2);
  });
  it("the database validator rejects invalid records", async () => {
    const { transferId } = await make();
    await expect(transfersCollection(db).updateOne({ transferId }, { $set: { status: "Lost" as never } })).rejects.toMatchObject({ code: 121 });
    await expect(transfersCollection(db).updateOne({ transferId }, { $set: { direction: "sideways" as never } })).rejects.toMatchObject({ code: 121 });
  });
});

describe("acceptTransfer", () => {
  it("confirms receipt atomically: time, administrator, notes, history and a sync job; others untouched", async () => {
    const a = (await make()).transferId;
    const other = (await make({ name: "Bilal Ahmed" })).transferId;
    const otherBefore = JSON.stringify(await get(other));

    const r = await accept(a, "Arrived intact.");
    const doc = (await get(a))!;
    expect(doc).toMatchObject({ status: "Received", receivedBy: ADMIN_ID, receiptNotes: "Arrived intact.", version: 2, googleSheetSynced: false, syncState: "pending" });
    expect(doc.receivedAt!.getTime()).toBe(r.receivedAt.getTime());
    expect(doc.history.map((h) => h.action)).toEqual(["created", "received"]);
    expect(doc.history[1]).toMatchObject({ actor: ADMIN_ID, note: "Arrived intact." });
    expect(await syncJobsCollection(db).findOne({ eventId: `transfer.received:${a}:2` })).toMatchObject({ type: "transfer.received", status: "pending" });
    expect(JSON.stringify(await get(other))).toBe(otherBefore);
  });
  it("never confirms twice: a repeat is a 409 and the first confirmation is preserved", async () => {
    const a = (await make()).transferId;
    await accept(a, "first");
    const first = (await get(a))!;
    expect(await status(accept(a, "second"))).toBe(409);
    const after = (await get(a))!;
    expect(after.receivedAt!.getTime()).toBe(first.receivedAt!.getTime());
    expect(after).toMatchObject({ receiptNotes: "first", version: 2 });
    expect(after.history).toHaveLength(2);
    expect(await syncJobsCollection(db).countDocuments({ complaintId: a, type: "transfer.received" })).toBe(1);
  });
  it("simultaneous accepts: exactly one wins", async () => {
    const a = (await make()).transferId;
    const r = await Promise.all(Array.from({ length: 6 }, () => status(accept(a))));
    expect(r.filter((x) => x === null)).toHaveLength(1);
    expect(r.filter((x) => x === 409)).toHaveLength(5);
    expect((await get(a))!.history).toHaveLength(2);
  });
  it("stores notes literally even if they look like a field path, and 404s for unknown records", async () => {
    const a = (await make()).transferId;
    await accept(a, "$receivedAt");
    expect(await get(a)).toMatchObject({ receiptNotes: "$receivedAt" });
    expect(await status(accept("TR-20260101-AAAA"))).toBe(404);
  });
  it("works for items going out from IT, and does not hide a failed sync flag", async () => {
    const a = (await make({}, "from_it", "admin")).transferId;
    await transfersCollection(db).updateOne({ transferId: a }, { $set: { syncState: "needs_reconciliation", syncError: "No row" } });
    await accept(a);
    expect(await get(a)).toMatchObject({ status: "Received", syncState: "needs_reconciliation", syncError: "No row" });
  });
});

describe("listing", () => {
  it("filters by direction, status, outlet and search; In transit comes first", async () => {
    const a = (await make({ outlet: "Malir" })).transferId;
    await make({ outlet: "Clifton" });
    await make({ outlet: "Malir" }, "from_it", "admin");
    await accept(a);
    expect((await listTransfers(db, q({ direction: "from_it" }))).total).toBe(1);
    expect((await listTransfers(db, q({ outlet: "Malir" }))).total).toBe(2);
    expect((await listTransfers(db, q({ status: "Received" }))).items.map((i) => i.transferId)).toEqual([a]);
    expect((await listTransfers(db, q({ q: "clifton" }))).total).toBe(1);
    expect((await listTransfers(db, q({ q: a.slice(-4).toLowerCase() }))).items.map((i) => i.transferId)).toContain(a);
    expect((await listTransfers(db, q({ q: ".*" }))).total).toBe(0);
    expect((await listTransfers(db, q())).items.map((i) => i.status)).toEqual(["In transit", "In transit", "Received"]);
  });
  it("paginates without gaps or repeats", async () => {
    await Promise.all(Array.from({ length: 23 }, () => make()));
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await listTransfers(db, q({ pageSize: "10", page: String(page) }));
      expect(r.totalPages).toBe(3);
      seen.push(...r.items.map((i) => i.transferId));
    }
    expect(new Set(seen).size).toBe(23);
  });
  it("counts items still on their way, per direction", async () => {
    const a = (await make()).transferId;
    await make();
    await make({}, "from_it", "admin");
    await accept(a);
    expect(await countInTransit(db)).toEqual({ toIt: 1, fromIt: 1 });
  });
  it("detail view names administrators; public confirmation is limited", async () => {
    const a = (await make({ email: "private@example.com" })).transferId;
    await accept(a, "ok");
    const full = (await getTransferFull(db, a))!;
    expect(full.transfer.receivedByName).toBe("IT Admin");
    expect(full.transfer.history.map((h) => h.actor)).toEqual(["Outlet (public form)", "IT Admin"]);
    expect(full.syncJobs.map((j) => j.type)).toEqual(["transfer.created", "transfer.received"]);
    const c = (await getTransferConfirmation(db, a))!;
    expect(Object.keys(c).sort()).toEqual(["createdAt", "direction", "outlet", "status", "transferId"]);
    expect(JSON.stringify(c)).not.toContain("private@example.com");
    expect(await getTransferFull(db, "TR-20260101-AAAA")).toBeNull();
  });
});

describe("spreadsheet sync of transfers", () => {
  const ok = async (e: TransferSyncEvent) => ({ kind: "success" as const, result: e.eventType === "transfer.created" ? ("appended" as const) : ("updated" as const), rowNumber: 2 });

  it("syncs a new record, then marks it synced only when n8n confirms", async () => {
    const { transferId, eventId } = await make();
    const sendTransfer = vi.fn(ok);
    expect(await dispatchJobByEventId(db, eventId, { sendTransfer })).toBe("done");
    expect(sendTransfer.mock.calls[0]![0]).toMatchObject({ eventType: "transfer.created", transferId });
    expect(sendTransfer.mock.calls[0]![0].row).toMatchObject({ "Transfer ID": transferId, Status: "In transit", Direction: "To IT", "Logged By": "Outlet (public form)" });
    expect(await get(transferId)).toMatchObject({ googleSheetSynced: true, syncState: "synced" });
  });
  it("an update waits for the create job, then sends the receipt with the administrator's name", async () => {
    const { transferId, eventId } = await make();
    await accept(transferId, "Intact");
    const received = (await syncJobsCollection(db).findOne({ type: "transfer.received" }))!;
    const sendTransfer = vi.fn(ok);

    const claimed = (await claimJob(db, new Date(), received.eventId))!;
    expect(await processJob(db, claimed, { sendTransfer })).toBe("deferred");
    expect(sendTransfer).not.toHaveBeenCalled();

    await dispatchJobByEventId(db, eventId, { sendTransfer });
    await syncJobsCollection(db).updateOne({ eventId: received.eventId }, { $set: { nextAttemptAt: new Date(0) } });
    expect(await dispatchJobByEventId(db, received.eventId, { sendTransfer })).toBe("done");
    expect(sendTransfer.mock.calls[1]![0].row).toMatchObject({ Status: "Received", "Received By": "IT Admin", "Receipt Notes": "Intact" });
    expect(await get(transferId)).toMatchObject({ syncState: "synced" });
  });
  it("temporary failures keep the record and retry; 'row missing' flags it and is not retried", async () => {
    const { transferId, eventId } = await make();
    expect(await dispatchJobByEventId(db, eventId, { sendTransfer: async () => ({ kind: "retryable", message: "down" }) })).toBe("retry");
    expect(await syncJobsCollection(db).findOne({ eventId })).toMatchObject({ status: "pending", attempts: 1 });
    await syncJobsCollection(db).updateOne({ eventId }, { $set: { nextAttemptAt: new Date(0) } });
    expect(await dispatchJobByEventId(db, eventId, { sendTransfer: async () => ({ kind: "integrity", code: "row_missing", message: "No row" }) })).toBe("failed");
    expect(await get(transferId)).toMatchObject({ syncState: "needs_reconciliation" });
  });
  it("retryTransferSync re-queues stuck jobs only", async () => {
    const { transferId, eventId } = await make();
    expect(await status(retryTransferSync(db, { transferId }))).toBe(409);
    await syncJobsCollection(db).updateOne({ eventId }, { $set: { status: "dead", attempts: 8, lastError: "down" } });
    await transfersCollection(db).updateOne({ transferId }, { $set: { syncState: "failed", syncError: "down" } });
    expect((await retryTransferSync(db, { transferId })).eventIds).toEqual([eventId]);
    expect(await syncJobsCollection(db).findOne({ eventId })).toMatchObject({ status: "pending", attempts: 0 });
    expect(await get(transferId)).toMatchObject({ syncState: "pending", syncError: null });
  });
  it("an orphaned transfer job is parked instead of crashing the runner", async () => {
    const { transferId, eventId } = await make();
    await transfersCollection(db).deleteOne({ transferId });
    const job = (await claimJob(db, new Date(), eventId))!;
    expect(await processJob(db, job)).toBe("orphaned");
  });
});

describe("outlets setting", () => {
  it("falls back to defaults, can be saved, and saving departments alone leaves outlets untouched", async () => {
    expect(await getOutlets(db)).toEqual(["Malir", "Other"]);
    await saveFormOptions(db, { adminId: "a", input: { departments: ["IT"], categories: ["Other"], outlets: ["Malir", "Clifton", "DHA"] }, correlationId: "c-12345" });
    expect(await getOutlets(db)).toEqual(["Malir", "Clifton", "DHA"]);
    await saveFormOptions(db, { adminId: "a", input: { departments: ["IT", "HR"], categories: ["Other"] }, correlationId: "c-12345" });
    expect(await getOutlets(db)).toEqual(["Malir", "Clifton", "DHA"]);
    expect((await getFormOptions(db)).departments).toEqual(["IT", "HR"]);
  });
});
