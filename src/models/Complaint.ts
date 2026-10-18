import type { Db, ObjectId } from "mongodb";
import type { ComplaintPriority, ComplaintStatus } from "@/lib/constants";

export type SyncState = "pending" | "synced" | "failed" | "needs_reconciliation";

export interface ComplaintDoc {
  _id: ObjectId;
  /** Human-readable unique ID, e.g. IT-20261018-A7K2. Immutable. */
  complaintId: string;
  userName: string;
  department: string;
  problemCategory: string;
  problemDescription: string;
  /** Requested urgency. The admin may change it. */
  priority: ComplaintPriority;
  /** 1 (Low) to 4 (Critical). Denormalised so the table can sort by priority in the database. */
  priorityRank: number;
  contactNumber: string | null;

  /** Server-generated UTC. Immutable through the ordinary edit form. */
  receivedAt: Date;
  /** Set once, on the first successful resolution. */
  solvedAt: Date | null;
  /**
   * Duration of THIS complaint in whole minutes: solvedAt − receivedAt, rounded to the nearest
   * minute (halves up). Dashboard averages are computed from this field across resolved complaints.
   */
  solveDurationMinutes: number | null;
  workStuckReason: string | null;
  resolutionNotes: string | null;
  status: ComplaintStatus;
  /** _id (as string) of the administrator who resolved it. */
  resolvedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
  /** Incremented on every write; used for optimistic concurrency on edits. */
  version: number;

  googleSheetSynced: boolean;
  googleSheetSyncedAt: Date | null;
  syncState: SyncState;
  /** Sanitised message only. Never raw errors or credentials. */
  syncError: string | null;
}

export const complaintsCollection = (db: Db) => db.collection<ComplaintDoc>("complaints");
