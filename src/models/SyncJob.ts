import type { Db, ObjectId } from "mongodb";

export type ComplaintSyncJobType = "complaint.created" | "complaint.updated" | "complaint.resolved";
export type TransferSyncJobType = "transfer.created" | "transfer.received";
export type SyncJobType = ComplaintSyncJobType | TransferSyncJobType;
/**
 * pending    waiting for its turn (or for a retry)
 * processing leased by a runner; the lease expires if the runner dies
 * done       n8n confirmed the Google Sheets write
 * failed     integrity problem (row missing / duplicate rows): needs reconciliation, never auto-retried
 * dead       gave up (retries exhausted, or payload rejected): an administrator must retry it
 */
export type SyncJobStatus = "pending" | "processing" | "done" | "failed" | "dead";

/**
 * Transactional outbox. A job is inserted in the SAME transaction as the complaint change it
 * describes, so a stored complaint can never lack its sync job. The payload is rebuilt from
 * MongoDB at dispatch time, so a retry always sends the latest truth.
 */
export interface SyncJobDoc {
  _id: ObjectId;
  /** Idempotency key, unique. Sent to n8n so retries cannot duplicate rows. */
  eventId: string;
  type: SyncJobType;
  /** The ID of the record this job syncs: a complaint ID (IT-…) or, for transfer.* jobs, a transfer ID (TR-…). */
  complaintId: string;
  status: SyncJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  /** Lease: a runner owns the job until this time, which prevents double processing. */
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export const syncJobsCollection = (db: Db) => db.collection<SyncJobDoc>("syncjobs");
