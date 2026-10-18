import type { Db, ObjectId } from "mongodb";

export interface AdminDoc {
  _id: ObjectId;
  /** Lower-cased, unique. */
  email: string;
  name: string;
  /** Argon2id hash. Plain-text passwords are never stored. */
  passwordHash: string;
  disabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const adminsCollection = (db: Db) => db.collection<AdminDoc>("admins");
