import type { Db, ObjectId } from "mongodb";

/** Server-side session. Only a SHA-256 hash of the cookie token is stored, so a database leak cannot be replayed. */
export interface AdminSessionDoc {
  _id: ObjectId;
  tokenHash: string;
  adminId: ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  /** Absolute expiry; a TTL index deletes the document afterwards. */
  expiresAt: Date;
  userAgent: string | null;
  ipHash: string | null;
}

export const adminSessionsCollection = (db: Db) => db.collection<AdminSessionDoc>("adminsessions");
