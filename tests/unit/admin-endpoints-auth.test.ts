import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-config";
import { GET as listGet } from "@/app/api/admin/complaints/route";
import { GET as oneGet, PATCH as onePatch } from "@/app/api/admin/complaints/[id]/route";
import { POST as resolvePost } from "@/app/api/admin/complaints/[id]/resolve/route";
import { POST as syncPost } from "@/app/api/admin/complaints/[id]/sync/route";
import { GET as dashboardGet } from "@/app/api/admin/dashboard/route";
import { GET as auditGet } from "@/app/api/admin/audit-logs/route";
import { GET as reconGet, POST as reconPost } from "@/app/api/admin/reconciliation/route";
import { GET as optionsGet, PUT as optionsPut } from "@/app/api/admin/settings/form-options/route";
import { GET as transfersGet, POST as transfersPost } from "@/app/api/admin/transfers/route";
import { GET as transferGet } from "@/app/api/admin/transfers/[id]/route";
import { POST as transferAccept } from "@/app/api/admin/transfers/[id]/accept/route";
import { POST as transferSync } from "@/app/api/admin/transfers/[id]/sync/route";

const ID = "IT-20261018-A7K2";
const ctx = { params: Promise.resolve({ id: ID }) };
const TID = "TR-20261018-B3M9";
const tctx = { params: Promise.resolve({ id: TID }) };
const url = (p: string) => `http://localhost:3000${p}`;
const same = { origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000", "content-type": "application/json" };
const evil = { origin: "https://evil.example", "x-forwarded-host": "localhost:3000", "content-type": "application/json", cookie: `${SESSION_COOKIE}=abc` };

const reads: [string, () => Promise<Response>][] = [
  ["GET /complaints", () => listGet(new NextRequest(url("/api/admin/complaints")))],
  ["GET /complaints/[id]", () => oneGet(new NextRequest(url(`/api/admin/complaints/${ID}`)), ctx)],
  ["GET /dashboard", () => dashboardGet(new NextRequest(url("/api/admin/dashboard")))],
  ["GET /audit-logs", () => auditGet(new NextRequest(url("/api/admin/audit-logs")))],
  ["GET /settings/form-options", () => optionsGet(new NextRequest(url("/api/admin/settings/form-options")))],
  ["GET /transfers", () => transfersGet(new NextRequest(url("/api/admin/transfers")))],
  ["GET /transfers/[id]", () => transferGet(new NextRequest(url(`/api/admin/transfers/${TID}`)), tctx)],
  ["GET /reconciliation", () => reconGet(new NextRequest(url("/api/admin/reconciliation")))],
];
const writes: [string, (headers: Record<string, string>) => Promise<Response>][] = [
  ["PATCH /complaints/[id]", (h) => onePatch(new NextRequest(url(`/api/admin/complaints/${ID}`), { method: "PATCH", headers: h, body: JSON.stringify({ version: 1, priority: "Low" }) }), ctx)],
  ["POST /complaints/[id]/resolve", (h) => resolvePost(new NextRequest(url(`/api/admin/complaints/${ID}/resolve`), { method: "POST", headers: h, body: "{}" }), ctx)],
  ["PUT /settings/form-options", (h) => optionsPut(new NextRequest(url("/api/admin/settings/form-options"), { method: "PUT", headers: h, body: JSON.stringify({ departments: ["IT"], categories: ["Other"] }) }))],
  ["POST /transfers", (h) => transfersPost(new NextRequest(url("/api/admin/transfers"), { method: "POST", headers: h, body: "{}" }))],
  ["POST /transfers/[id]/accept", (h) => transferAccept(new NextRequest(url(`/api/admin/transfers/${TID}/accept`), { method: "POST", headers: h, body: "{}" }), tctx)],
  ["POST /transfers/[id]/sync", (h) => transferSync(new NextRequest(url(`/api/admin/transfers/${TID}/sync`), { method: "POST", headers: h, body: "{}" }), tctx)],
  ["POST /reconciliation", (h) => reconPost(new NextRequest(url("/api/admin/reconciliation"), { method: "POST", headers: h, body: "{}" }))],
  ["POST /complaints/[id]/sync", (h) => syncPost(new NextRequest(url(`/api/admin/complaints/${ID}/sync`), { method: "POST", headers: h, body: "{}" }), ctx)],
];

describe("every admin data endpoint refuses unauthenticated callers (before touching the database)", () => {
  it.each(reads)("%s → 401", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
  it.each(writes)("%s → 401 without a session", async (_n, call) => {
    expect((await call(same)).status).toBe(401);
  });
});

describe("state-changing admin endpoints refuse cross-origin requests even with a cookie", () => {
  it.each(writes)("%s → 403", async (_n, call) => {
    expect((await call(evil)).status).toBe(403);
  });
});
