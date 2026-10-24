import { ObjectId, type Db, type Filter } from "mongodb";
import { ApiError } from "@/lib/api";
import { SYNC_MAX_ATTEMPTS } from "@/lib/complaint-service";
import { escapeRegex } from "@/lib/complaint-admin-service";
import { generateTransferId } from "@/lib/complaint-id";
import type { TransferDirection } from "@/lib/constants";
import { log } from "@/lib/logger";
import { toTransferDetail, toTransferListItem, type TransferDetail, type TransferListItem } from "@/lib/transfer-view";
import type { TransferListQuery } from "@/lib/validation-transfer";
import { adminsCollection } from "@/models/Admin";
import { transfersCollection, type ItemTransferDoc } from "@/models/ItemTransfer";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

const MAX_ID_ATTEMPTS = 6;
const OPEN_STATES = ["synced", "pending"];

const isDuplicateTransferId = (err: unknown) => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return e?.code === 11000 && (Boolean(e.keyPattern && "transferId" in e.keyPattern) || Boolean(e.message?.includes("transferId")));
};

function newJob(transferId: string, type: SyncJobDoc["type"], version: number | null, now: Date): SyncJobDoc {
  return {
    _id: new ObjectId(),
    eventId: version === null ? `${type}:${transferId}` : `${type}:${transferId}:${version}`, // unique per change
    type,
    complaintId: transferId, // the generic record-ID field (see SyncJobDoc)
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

async function adminNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const valid = [...new Set(ids.filter((i): i is string => Boolean(i) && ObjectId.isValid(i!)))].map((i) => new ObjectId(i));
  const rows = valid.length ? await adminsCollection(db).find({ _id: { $in: valid } }, { projection: { name: 1 } }).toArray() : [];
  return new Map(rows.map((r) => [r._id.toHexString(), r.name]));
}

export interface NewTransferFields {
  name: string;
  email?: string;
  contact?: string;
  outlet: string;
  description: string;
}

/**
 * Record an item moving to or from IT. The record and its spreadsheet-sync job are written in ONE
 * transaction (so a stored record can never lack its sync job). The date is the server's clock.
 */
export async function createTransfer(
  db: Db,
  args: { fields: NewTransferFields; direction: TransferDirection; source: "public" | "admin"; actorId: string; correlationId: string },
): Promise<{ transferId: string; createdAt: Date; eventId: string }> {
  const { fields, direction, source, actorId, correlationId } = args;
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const now = new Date();
    const transferId = generateTransferId(now);
    const doc: ItemTransferDoc = {
      _id: new ObjectId(),
      transferId,
      direction,
      source,
      name: fields.name,
      email: fields.email ?? null,
      contact: fields.contact ?? null,
      outlet: fields.outlet,
      description: fields.description,
      status: "In transit",
      createdAt: now,
      updatedAt: now,
      receivedAt: null,
      receivedBy: null,
      receiptNotes: null,
      createdBy: actorId,
      version: 1,
      history: [{ at: now, action: "created", actor: actorId, note: null }],
      googleSheetSynced: false,
      googleSheetSyncedAt: null,
      syncState: "pending",
      syncError: null,
    };
    const job = newJob(transferId, "transfer.created", null, now);
    try {
      await db.client.withSession((session) =>
        session.withTransaction(async () => {
          await transfersCollection(db).insertOne(doc, { session });
          await syncJobsCollection(db).insertOne(job, { session });
        }),
      );
      log("info", "transfer.created", { transferId, direction, source, correlationId });
      return { transferId, createdAt: now, eventId: job.eventId };
    } catch (err) {
      if (isDuplicateTransferId(err) && attempt < MAX_ID_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("Unable to allocate a unique transfer ID");
}

/**
 * Confirm that the item arrived. One atomic MongoDB operation checks the record is still "In
 * transit" and records the time (database clock), the administrator and the notes together, so two
 * administrators clicking at once cannot both succeed and the first confirmation is never overwritten.
 */
export async function acceptTransfer(
  db: Db,
  args: { transferId: string; adminId: string; notes: string | null | undefined; correlationId: string },
): Promise<{ transferId: string; receivedAt: Date; version: number; eventId: string }> {
  const { transferId, adminId, notes, correlationId } = args;
  const col = transfersCollection(db);
  return db.client.withSession((session) =>
    session.withTransaction(async () => {
      const before = await col.findOne({ transferId }, { session });
      if (!before) throw new ApiError(404, "NOT_FOUND", "No item record found with that ID.");
      if (before.status === "Received") throw new ApiError(409, "ALREADY_RECEIVED", "This item has already been confirmed as received.");

      const keepState = !OPEN_STATES.includes(before.syncState);
      const after = await col.findOneAndUpdate(
        { _id: before._id, status: "In transit" },
        [
          {
            $set: {
              status: "Received",
              receivedAt: "$$NOW",
              receivedBy: { $literal: adminId },
              // $literal: notes must never be read as a field path or operator.
              receiptNotes: notes !== undefined ? { $literal: notes } : "$receiptNotes",
              updatedAt: "$$NOW",
              version: { $add: ["$version", 1] },
              history: { $concatArrays: ["$history", [{ at: "$$NOW", action: "received", actor: { $literal: adminId }, note: { $literal: notes ?? null } }]] },
              googleSheetSynced: false,
              syncState: { $literal: keepState ? before.syncState : "pending" },
              syncError: { $literal: keepState ? before.syncError : null },
            },
          },
        ],
        { returnDocument: "after", session },
      );
      if (!after || !after.receivedAt) throw new ApiError(409, "ALREADY_RECEIVED", "This item has already been confirmed as received.");

      const job = newJob(transferId, "transfer.received", after.version, after.receivedAt);
      await syncJobsCollection(db).insertOne(job, { session });
      log("info", "transfer.received", { transferId, adminId, correlationId });
      return { transferId, receivedAt: after.receivedAt, version: after.version, eventId: job.eventId };
    }),
  );
}

// ── Reading ────────────────────────────────────────────────────────────────

export function buildTransferFilter(q: TransferListQuery): Filter<ItemTransferDoc> {
  const f: Filter<ItemTransferDoc> = {};
  if (q.direction) f.direction = q.direction;
  if (q.status) f.status = q.status;
  if (q.outlet) f.outlet = q.outlet;
  if (q.q) {
    f.$or = [
      { transferId: { $regex: escapeRegex(q.q.toUpperCase()) } },
      { name: { $regex: escapeRegex(q.q), $options: "i" } },
      { outlet: { $regex: escapeRegex(q.q), $options: "i" } },
    ];
  }
  return f;
}

export interface TransferPage {
  items: TransferListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Items still on their way come first, newest first within each group. */
export async function listTransfers(db: Db, q: TransferListQuery): Promise<TransferPage> {
  const filter = buildTransferFilter(q);
  const col = transfersCollection(db);
  const [total, docs] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter).sort({ status: 1, createdAt: -1, _id: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).toArray(),
  ]);
  const names = await adminNames(db, docs.map((d) => d.receivedBy));
  return { items: docs.map((d) => toTransferListItem(d, names)), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function countInTransit(db: Db): Promise<{ toIt: number; fromIt: number }> {
  const col = transfersCollection(db);
  const [toIt, fromIt] = await Promise.all([
    col.countDocuments({ status: "In transit", direction: "to_it" }),
    col.countDocuments({ status: "In transit", direction: "from_it" }),
  ]);
  return { toIt, fromIt };
}

export interface TransferFull {
  transfer: TransferDetail;
  syncJobs: { type: SyncJobDoc["type"]; status: SyncJobDoc["status"]; attempts: number; lastError: string | null }[];
}

export async function getTransferFull(db: Db, transferId: string): Promise<TransferFull | null> {
  const t = await transfersCollection(db).findOne({ transferId });
  if (!t) return null;
  const [names, jobs] = await Promise.all([
    adminNames(db, [t.receivedBy, t.createdBy, ...t.history.map((h) => h.actor)]),
    syncJobsCollection(db).find({ complaintId: transferId }).sort({ createdAt: 1 }).toArray(),
  ]);
  return {
    transfer: toTransferDetail(t, names),
    syncJobs: jobs.map((j) => ({ type: j.type, status: j.status, attempts: j.attempts, lastError: j.lastError })),
  };
}

/** Deliberately limited public view: no name, email, contact or description. */
export async function getTransferConfirmation(db: Db, transferId: string) {
  return transfersCollection(db).findOne(
    { transferId },
    { projection: { _id: 0, transferId: 1, direction: 1, outlet: 1, status: 1, createdAt: 1 } },
  ) as Promise<Pick<ItemTransferDoc, "transferId" | "direction" | "outlet" | "status" | "createdAt"> | null>;
}

/** Put this record's failed or exhausted sync jobs back in the queue. */
export async function retryTransferSync(db: Db, args: { transferId: string }): Promise<{ eventIds: string[] }> {
  return db.client.withSession((session) =>
    session.withTransaction(async () => {
      const col = transfersCollection(db);
      if (!(await col.findOne({ transferId: args.transferId }, { session, projection: { _id: 1 } }))) {
        throw new ApiError(404, "NOT_FOUND", "No item record found with that ID.");
      }
      const jobs = syncJobsCollection(db);
      const stuck = await jobs.find({ complaintId: args.transferId, status: { $in: ["failed", "dead"] } }, { session }).sort({ createdAt: 1 }).toArray();
      if (stuck.length === 0) throw new ApiError(409, "NOTHING_TO_RETRY", "There is nothing to retry for this item.");
      const now = new Date();
      await jobs.updateMany(
        { _id: { $in: stuck.map((j) => j._id) } },
        { $set: { status: "pending", attempts: 0, nextAttemptAt: now, lockedUntil: null, lastError: null, updatedAt: now } },
        { session },
      );
      await col.updateOne({ transferId: args.transferId }, { $set: { syncState: "pending", syncError: null } }, { session });
      return { eventIds: stuck.map((j) => j.eventId) };
    }),
  );
}

