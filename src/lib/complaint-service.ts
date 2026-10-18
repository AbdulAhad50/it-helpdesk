import { ObjectId, type Db } from "mongodb";
import { PRIORITY_RANK } from "@/lib/constants";
import { generateComplaintId } from "@/lib/complaint-id";
import { getDb } from "@/lib/mongodb";
import { log } from "@/lib/logger";
import type { ComplaintInput } from "@/lib/validation";
import { auditLogsCollection } from "@/models/AuditLog";
import { complaintsCollection, type ComplaintDoc } from "@/models/Complaint";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

const MAX_ID_ATTEMPTS = 6;
export const SYNC_MAX_ATTEMPTS = 8;

function isDuplicateComplaintId(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return e?.code === 11000 && (Boolean(e.keyPattern && "complaintId" in e.keyPattern) || Boolean(e.message?.includes("complaintId")));
}

export interface CreatedComplaint {
  complaintId: string;
  receivedAt: Date;
  status: "Pending";
}

/**
 * Persist a new complaint.
 *
 * In ONE transaction we write: the complaint (always Pending, server timestamp), the outbox job
 * that will sync it to Google Sheets via n8n, and an audit entry. Either all three exist or none
 * do, so a stored complaint can never be missing its sync job.
 *
 * The call returns as soon as MongoDB has committed. Spreadsheet sync happens afterwards and its
 * result is tracked separately on the record (syncState), never assumed.
 */
export async function createComplaint(
  input: ComplaintInput,
  ctx: { correlationId: string },
  dbOverride?: Db,
): Promise<CreatedComplaint> {
  const db = dbOverride ?? (await getDb());

  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const now = new Date(); // server clock only; the browser clock is never trusted
    const complaintId = generateComplaintId(now);

    const complaint: ComplaintDoc = {
      _id: new ObjectId(),
      complaintId,
      userName: input.userName,
      department: input.department,
      problemCategory: input.problemCategory,
      problemDescription: input.problemDescription,
      priority: input.priority,
      priorityRank: PRIORITY_RANK[input.priority],
      contactNumber: input.contactNumber ?? null,
      receivedAt: now,
      solvedAt: null,
      solveDurationMinutes: null,
      workStuckReason: null,
      resolutionNotes: null,
      status: "Pending",
      resolvedBy: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      googleSheetSynced: false,
      googleSheetSyncedAt: null,
      syncState: "pending",
      syncError: null,
    };

    const job: SyncJobDoc = {
      _id: new ObjectId(),
      eventId: `complaint.created:${complaintId}`,
      type: "complaint.created",
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

    try {
      await db.client.withSession((session) =>
        session.withTransaction(async () => {
          await complaintsCollection(db).insertOne(complaint, { session });
          await syncJobsCollection(db).insertOne(job, { session });
          await auditLogsCollection(db).insertOne(
            {
              _id: new ObjectId(),
              complaintId,
              action: "complaint.created",
              actor: "public",
              changes: [],
              correlationId: ctx.correlationId,
              createdAt: now,
            },
            { session },
          );
        }),
      );
      log("info", "complaint.created", { complaintId, correlationId: ctx.correlationId, attempt });
      return { complaintId, receivedAt: now, status: "Pending" };
    } catch (err) {
      if (isDuplicateComplaintId(err) && attempt < MAX_ID_ATTEMPTS) {
        log("warn", "complaint.id_collision", { complaintId, correlationId: ctx.correlationId, attempt });
        continue; // draw a new random suffix
      }
      throw err;
    }
  }
  throw new Error("Unable to allocate a unique complaint ID"); // unreachable: loop returns or throws
}

export interface ComplaintConfirmation {
  complaintId: string;
  status: ComplaintDoc["status"];
  priority: ComplaintDoc["priority"];
  problemCategory: string;
  receivedAt: Date;
}

/** Deliberately limited: no name, description, contact number or internal IDs. */
export async function getConfirmation(complaintId: string, dbOverride?: Db): Promise<ComplaintConfirmation | null> {
  const db = dbOverride ?? (await getDb());
  return complaintsCollection(db).findOne(
    { complaintId },
    { projection: { _id: 0, complaintId: 1, status: 1, priority: 1, problemCategory: 1, receivedAt: 1 } },
  ) as Promise<ComplaintConfirmation | null>;
}
