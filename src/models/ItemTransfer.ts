import type { Db, ObjectId } from "mongodb";
import type { TransferDirection, TransferStatus } from "@/lib/constants";
import type { SyncState } from "@/models/Complaint";

export interface TransferHistoryEntry {
  at: Date;
  action: "created" | "received";
  /** "public" for an outlet's own submission, otherwise the administrator's _id as a string. */
  actor: string;
  note: string | null;
}

/** An item moving between an outlet and IT. */
export interface ItemTransferDoc {
  _id: ObjectId;
  /** Human-readable unique ID, e.g. TR-20261018-B3M9. Immutable. */
  transferId: string;
  direction: TransferDirection;
  /** Where the record came from. */
  source: "public" | "admin";
  /** Sender (to_it) or the person at the outlet the item is going to (from_it). */
  name: string;
  email: string | null;
  contact: string | null;
  outlet: string;
  description: string;
  status: TransferStatus;
  /** Server-generated UTC: the "Date" shown on the form record. Immutable. */
  createdAt: Date;
  updatedAt: Date;
  receivedAt: Date | null;
  /** Administrator _id (as a string) who confirmed the item arrived. */
  receivedBy: string | null;
  receiptNotes: string | null;
  createdBy: string;
  version: number;
  history: TransferHistoryEntry[];

  googleSheetSynced: boolean;
  googleSheetSyncedAt: Date | null;
  syncState: SyncState;
  syncError: string | null;
}

export const transfersCollection = (db: Db) => db.collection<ItemTransferDoc>("itemtransfers");
