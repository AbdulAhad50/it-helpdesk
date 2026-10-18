import type { Db, ObjectId } from "mongodb";

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditLogDoc {
  _id: ObjectId;
  complaintId: string;
  /** e.g. complaint.created, complaint.updated, complaint.resolved, sync.retried */
  action: string;
  /** Administrator _id as a string, or "public" for employee submissions, or "system". */
  actor: string;
  changes: AuditChange[];
  correlationId: string;
  createdAt: Date;
}

export const auditLogsCollection = (db: Db) => db.collection<AuditLogDoc>("auditlogs");
