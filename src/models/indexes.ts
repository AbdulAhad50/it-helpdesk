import type { Db } from "mongodb";
import { COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "@/lib/constants";

const nullableString = { bsonType: ["string", "null"] };
const nullableDate = { bsonType: ["date", "null"] };

const complaintValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "complaintId", "userName", "department", "problemCategory", "problemDescription",
      "priority", "priorityRank", "receivedAt", "status", "createdAt", "updatedAt", "version", "syncState",
    ],
    properties: {
      complaintId: { bsonType: "string", pattern: "^IT-[0-9]{8}-[A-HJKMNP-Z2-9]{4}$" },
      userName: { bsonType: "string", minLength: 2, maxLength: 100 },
      department: { bsonType: "string", minLength: 1, maxLength: 100 },
      problemCategory: { bsonType: "string", minLength: 1, maxLength: 100 },
      problemDescription: { bsonType: "string", minLength: 1, maxLength: 3000 },
      priority: { enum: [...COMPLAINT_PRIORITIES] },
      priorityRank: { bsonType: "int", minimum: 1, maximum: 4 },
      contactNumber: { bsonType: ["string", "null"], maxLength: 30 },
      receivedAt: { bsonType: "date" },
      solvedAt: nullableDate,
      solveDurationMinutes: { bsonType: ["int", "long", "double", "null"], minimum: 0 },
      workStuckReason: nullableString,
      resolutionNotes: nullableString,
      status: { enum: [...COMPLAINT_STATUSES] },
      resolvedBy: nullableString,
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
      version: { bsonType: ["int", "long"], minimum: 1 },
      googleSheetSynced: { bsonType: "bool" },
      googleSheetSyncedAt: nullableDate,
      syncState: { enum: ["pending", "synced", "failed", "needs_reconciliation"] },
      syncError: nullableString,
    },
  },
};

const syncJobValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["eventId", "type", "complaintId", "status", "attempts", "maxAttempts", "nextAttemptAt", "createdAt", "updatedAt"],
    properties: {
      eventId: { bsonType: "string" },
      type: { enum: ["complaint.created", "complaint.updated", "complaint.resolved"] },
      status: { enum: ["pending", "processing", "done", "failed", "dead"] },
      attempts: { bsonType: ["int", "long"], minimum: 0 },
    },
  },
};

async function ensureCollection(db: Db, name: string, validator?: object) {
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) {
    await db.createCollection(name, validator ? { validator, validationLevel: "strict", validationAction: "error" } : {});
  } else if (validator) {
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  }
}

/**
 * Idempotent database initialisation: collections, $jsonSchema validators and every index.
 * Run `npm run db:init` once per environment (and after upgrades). The unique indexes below are
 * what actually guarantee complaintId and eventId uniqueness, so do not skip this step.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await ensureCollection(db, "complaints", complaintValidator);
  await ensureCollection(db, "syncjobs", syncJobValidator);
  for (const name of ["admins", "adminsessions", "auditlogs", "ratelimits", "settings"]) await ensureCollection(db, name);

  const complaints = db.collection("complaints");
  await complaints.createIndex({ complaintId: 1 }, { unique: true, name: "uniq_complaintId" });
  await complaints.createIndex({ status: 1, receivedAt: -1 }, { name: "status_receivedAt" });
  await complaints.createIndex({ receivedAt: -1 }, { name: "receivedAt" });
  await complaints.createIndex({ department: 1, receivedAt: -1 }, { name: "department_receivedAt" });
  await complaints.createIndex({ problemCategory: 1, receivedAt: -1 }, { name: "category_receivedAt" });
  await complaints.createIndex({ priorityRank: -1, receivedAt: -1 }, { name: "priority_receivedAt" });
  await complaints.createIndex({ syncState: 1 }, { name: "syncState" });
  await complaints.createIndex(
    { userName: 1 },
    { name: "userName_ci", collation: { locale: "en", strength: 2 } },
  );

  const jobs = db.collection("syncjobs");
  await jobs.createIndex({ eventId: 1 }, { unique: true, name: "uniq_eventId" });
  await jobs.createIndex({ status: 1, nextAttemptAt: 1 }, { name: "due_jobs" });
  await jobs.createIndex({ complaintId: 1, createdAt: 1 }, { name: "complaint_jobs" });

  await db.collection("admins").createIndex({ email: 1 }, { unique: true, name: "uniq_email" });
  const sessions = db.collection("adminsessions");
  await sessions.createIndex({ tokenHash: 1 }, { unique: true, name: "uniq_tokenHash" });
  await sessions.createIndex({ adminId: 1 }, { name: "session_admin" });
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_session_expiresAt" });
  await db.collection("auditlogs").createIndex({ complaintId: 1, createdAt: -1 }, { name: "complaint_audit" });
  await db.collection("auditlogs").createIndex({ createdAt: -1 }, { name: "audit_recent" });
  await db.collection("ratelimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiresAt" });
}
