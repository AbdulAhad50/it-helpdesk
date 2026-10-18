import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { startTestDb } from "./helpers";
import { authenticate, createSession, hashToken, revokeAllSessions, revokeSession, validateSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS } from "@/lib/session-config";
import { resetEnvCache } from "@/lib/env";
import { adminsCollection } from "@/models/Admin";
import { adminSessionsCollection } from "@/models/AdminSession";

let db: Db;
let stop: () => Promise<void>;
const PASSWORD = "purple-tractor-notebook-42";
const NEW_PASSWORD = "orange-lantern-harbour-77";
let adminId: ObjectId;

const routes = async () => ({
  login: (await import("@/app/api/admin/auth/login/route")).POST,
  logout: (await import("@/app/api/admin/auth/logout/route")).POST,
  me: (await import("@/app/api/admin/auth/me/route")).GET,
  changePassword: (await import("@/app/api/admin/auth/change-password/route")).POST,
});

beforeAll(async () => {
  const t = await startTestDb();
  ({ db, stop } = t);
  process.env.MONGODB_URI = t.uri;
  process.env.MONGODB_DB_NAME = t.dbName;
  process.env.AUTH_SECRET = "x".repeat(48);
  resetEnvCache();
  (globalThis as { __mongoClient?: unknown }).__mongoClient = undefined; // route handlers connect to the test database
});
afterAll(async () => stop());

beforeEach(async () => {
  await Promise.all(["admins", "adminsessions", "ratelimits"].map((c) => db.collection(c).deleteMany({})));
  adminId = new ObjectId();
  const now = new Date();
  await adminsCollection(db).insertOne({
    _id: adminId, email: "it@company.com", name: "IT Admin", passwordHash: await hashPassword(PASSWORD),
    disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now,
  });
});

const same = { origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000", "content-type": "application/json" };
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { ...same, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!; // "name=token"

describe("authenticate", () => {
  it("accepts the right credentials (email is case-insensitive) and records lastLoginAt", async () => {
    const admin = await authenticate(db, "  IT@Company.com ", PASSWORD);
    expect(admin?._id.equals(adminId)).toBe(true);
    expect((await adminsCollection(db).findOne({ _id: adminId }))?.lastLoginAt).toBeInstanceOf(Date);
  });
  it("rejects a wrong password, an unknown email and a disabled account identically (null)", async () => {
    expect(await authenticate(db, "it@company.com", "wrong password here")).toBeNull();
    expect(await authenticate(db, "nobody@company.com", PASSWORD)).toBeNull();
    await adminsCollection(db).updateOne({ _id: adminId }, { $set: { disabled: true } });
    expect(await authenticate(db, "it@company.com", PASSWORD)).toBeNull();
  });
});

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const { token } = await createSession(db, adminId);
    const doc = await adminSessionsCollection(db).findOne({ adminId });
    expect(doc?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(doc)).not.toContain(token);
  });
  it("validates a fresh session and rejects unknown tokens", async () => {
    const { token } = await createSession(db, adminId);
    expect((await validateSession(db, token))?.admin.email).toBe("it@company.com");
    expect(await validateSession(db, "not-a-real-token")).toBeNull();
    expect(await validateSession(db, undefined)).toBeNull();
  });
  it("expires after the idle timeout and deletes the session", async () => {
    const start = new Date();
    const { token } = await createSession(db, adminId, {}, start);
    expect(await validateSession(db, token, new Date(start.getTime() + SESSION_IDLE_MS + 1000))).toBeNull();
    expect(await adminSessionsCollection(db).countDocuments({ adminId })).toBe(0);
  });
  it("expires at the absolute limit even when kept active", async () => {
    const start = new Date();
    const { token } = await createSession(db, adminId, {}, start);
    let t = start.getTime();
    while (t + 30 * 60_000 < start.getTime() + SESSION_ABSOLUTE_MS) {
      t += 30 * 60_000;
      expect(await validateSession(db, token, new Date(t))).not.toBeNull(); // activity keeps it idle-fresh
    }
    expect(await validateSession(db, token, new Date(start.getTime() + SESSION_ABSOLUTE_MS + 1000))).toBeNull();
  });
  it("is invalid once the admin is disabled", async () => {
    const { token } = await createSession(db, adminId);
    await adminsCollection(db).updateOne({ _id: adminId }, { $set: { disabled: true } });
    expect(await validateSession(db, token)).toBeNull();
  });
  it("revokeSession ends one session; revokeAllSessions can keep one", async () => {
    const a = await createSession(db, adminId);
    const b = await createSession(db, adminId);
    const ctxB = (await validateSession(db, b.token))!;
    expect(await revokeAllSessions(db, adminId, ctxB.sessionId)).toBe(1);
    expect(await validateSession(db, a.token)).toBeNull();
    await revokeSession(db, ctxB.sessionId);
    expect(await validateSession(db, b.token)).toBeNull();
  });
});

describe("admin auth API lifecycle", () => {
  it("login → me → logout → me (401)", async () => {
    const r = await routes();
    const res = await r.login(req("/api/admin/auth/login", "POST", { email: "it@company.com", password: PASSWORD }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = cookieFrom(res);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(JSON.stringify(await res.json())).not.toContain("passwordHash");

    const meRes = await r.me(req("/api/admin/auth/me", "GET", undefined, { cookie }));
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).data.admin.email).toBe("it@company.com");

    const out = await r.logout(req("/api/admin/auth/logout", "POST", undefined, { cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");

    expect((await r.me(req("/api/admin/auth/me", "GET", undefined, { cookie }))).status).toBe(401); // server-side revocation
  });

  it("gives the same 401 message for a wrong password and an unknown email", async () => {
    const r = await routes();
    const a = await r.login(req("/api/admin/auth/login", "POST", { email: "it@company.com", password: "wrong password here" }));
    const b = await r.login(req("/api/admin/auth/login", "POST", { email: "ghost@company.com", password: "wrong password here" }));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const [ba, bb] = [await a.json(), await b.json()];
    expect(ba.error.message).toBe(bb.error.message);
    expect(ba.error.code).toBe(bb.error.code);
  });

  it("rate-limits repeated attempts against one account with 429 and Retry-After", async () => {
    const r = await routes();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 10; i++) {
      last = await r.login(req("/api/admin/auth/login", "POST", { email: "it@company.com", password: "wrong password here" }));
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("a stolen-looking cookie that was never issued is rejected", async () => {
    const r = await routes();
    const res = await r.me(req("/api/admin/auth/me", "GET", undefined, { cookie: `${SESSION_COOKIE}=${"A".repeat(43)}` }));
    expect(res.status).toBe(401);
  });

  it("change-password: wrong current password → 400 field error; weak new password → 422", async () => {
    const r = await routes();
    const { token } = await createSession(db, adminId);
    const cookie = `${SESSION_COOKIE}=${token}`;
    const wrong = await r.changePassword(req("/api/admin/auth/change-password", "POST", { currentPassword: "nope nope nope", newPassword: NEW_PASSWORD }, { cookie }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.fieldErrors.currentPassword).toBeDefined();
    const weak = await r.changePassword(req("/api/admin/auth/change-password", "POST", { currentPassword: PASSWORD, newPassword: "short" }, { cookie }));
    expect(weak.status).toBe(422);
    expect((await weak.json()).error.fieldErrors.newPassword).toBeDefined();
  });

  it("change-password: updates the hash, keeps this session, signs out the others", async () => {
    const r = await routes();
    const mine = await createSession(db, adminId);
    const other = await createSession(db, adminId);
    const res = await r.changePassword(
      req("/api/admin/auth/change-password", "POST", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { cookie: `${SESSION_COOKIE}=${mine.token}` }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.otherSignedOut).toBe(1);
    expect(await validateSession(db, mine.token)).not.toBeNull();
    expect(await validateSession(db, other.token)).toBeNull();
    expect(await authenticate(db, "it@company.com", PASSWORD)).toBeNull();
    expect(await authenticate(db, "it@company.com", NEW_PASSWORD)).not.toBeNull();
  });
});
