import { createHash, randomBytes } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "@/lib/session-config";
import { adminsCollection, type AdminDoc } from "@/models/Admin";
import { adminSessionsCollection, type AdminSessionDoc } from "@/models/AdminSession";

export interface PublicAdmin {
  id: string;
  email: string;
  name: string;
}

export interface AdminContext {
  admin: PublicAdmin;
  sessionId: string;
  sessionExpiresAt: Date;
}

export const toPublicAdmin = (a: AdminDoc): PublicAdmin => ({ id: a._id.toHexString(), email: a.email, name: a.name });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionState = "valid" | "expired" | "idle";

/** Pure decision function: is this session still usable at `now`? */
export function evaluateSession(
  session: Pick<AdminSessionDoc, "expiresAt" | "lastSeenAt">,
  now: Date,
): SessionState {
  if (now.getTime() >= session.expiresAt.getTime()) return "expired";
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_IDLE_MS) return "idle";
  return "valid";
}

// ── Cookies ────────────────────────────────────────────────────────────────

const isProd = () => process.env.NODE_ENV === "production";

export function sessionCookie(token: string, expiresAt: Date, now = new Date()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd() ? "; Secure" : ""}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd() ? "; Secure" : ""}`;
}

// ── Credentials ────────────────────────────────────────────────────────────

let dummyHash: Promise<string> | undefined;
/** Verified against when the account doesn't exist, so response time doesn't reveal which emails are real. */
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

/** Returns the admin on success, otherwise null, with no hint as to why. */
export async function authenticate(db: Db, email: string, password: string): Promise<AdminDoc | null> {
  const admin = await adminsCollection(db).findOne({ email: email.trim().toLowerCase() });
  const ok = await verifyPassword(admin?.passwordHash ?? (await getDummyHash()), password);
  if (!admin || admin.disabled || !ok) return null;
  const now = new Date();
  await adminsCollection(db).updateOne({ _id: admin._id }, { $set: { lastLoginAt: now } });
  return admin;
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createSession(
  db: Db,
  adminId: ObjectId,
  meta: { userAgent?: string | null; ipHash?: string | null } = {},
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url"); // 256 bits from the OS CSPRNG
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await adminSessionsCollection(db).insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    adminId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : null,
    ipHash: meta.ipHash ?? null,
  });
  return { token, expiresAt };
}

/** Resolves a cookie token to an admin, or null. Expired, idle or orphaned sessions are deleted on sight. */
export async function validateSession(db: Db, token: string | undefined, now = new Date()): Promise<AdminContext | null> {
  if (!token || token.length > 200) return null;
  const sessions = adminSessionsCollection(db);
  const session = await sessions.findOne({ tokenHash: hashToken(token) });
  if (!session) return null;

  if (evaluateSession(session, now) !== "valid") {
    await sessions.deleteOne({ _id: session._id });
    return null;
  }
  const admin = await adminsCollection(db).findOne({ _id: session.adminId });
  if (!admin || admin.disabled) {
    await sessions.deleteOne({ _id: session._id });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
  }
  return { admin: toPublicAdmin(admin), sessionId: session._id.toHexString(), sessionExpiresAt: session.expiresAt };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await adminSessionsCollection(db).deleteOne({ _id: new ObjectId(sessionId) });
}

/** Sign an admin out everywhere, optionally keeping one session (e.g. the one changing the password). */
export async function revokeAllSessions(db: Db, adminId: ObjectId, exceptSessionId?: string): Promise<number> {
  const filter = exceptSessionId
    ? { adminId, _id: { $ne: new ObjectId(exceptSessionId) } }
    : { adminId };
  return (await adminSessionsCollection(db).deleteMany(filter)).deletedCount;
}
