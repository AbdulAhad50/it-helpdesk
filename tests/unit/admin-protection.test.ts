import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { SESSION_COOKIE } from "@/lib/session-config";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { POST as logout } from "@/app/api/admin/auth/logout/route";
import { GET as me } from "@/app/api/admin/auth/me/route";
import { POST as changePassword } from "@/app/api/admin/auth/change-password/route";

const url = (path: string) => `http://localhost:3000${path}`;
const same = { origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000" };
const json = { "content-type": "application/json" };

describe("proxy (first-layer gate)", () => {
  it("redirects admin pages to login, remembering where the user was going", () => {
    const res = proxy(new NextRequest(url("/admin/dashboard")));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/admin/login");
    expect(loc.searchParams.get("next")).toBe("/admin/dashboard");
  });
  it("returns 401 JSON for admin API calls without a cookie", async () => {
    const res = proxy(new NextRequest(url("/api/admin/complaints")));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
  it("lets the login page and login API through", () => {
    expect(proxy(new NextRequest(url("/admin/login"))).headers.get("location")).toBeNull();
    expect(proxy(new NextRequest(url("/api/admin/auth/login"), { method: "POST" })).status).toBe(200);
  });
  it("passes requests that carry a cookie (real validation happens server-side) and disables caching", () => {
    const res = proxy(new NextRequest(url("/admin/dashboard"), { headers: { cookie: `${SESSION_COOKIE}=abc` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("admin API endpoints reject unauthorised calls before touching the database", () => {
  it("GET /me without a session → 401", async () => {
    const res = await me(new NextRequest(url("/api/admin/auth/me")));
    expect(res.status).toBe(401);
  });
  it("POST /logout without a session → 401", async () => {
    const res = await logout(new NextRequest(url("/api/admin/auth/logout"), { method: "POST", headers: same }));
    expect(res.status).toBe(401);
  });
  it("POST /change-password without a session → 401", async () => {
    const res = await changePassword(
      new NextRequest(url("/api/admin/auth/change-password"), { method: "POST", headers: { ...same, ...json }, body: "{}" }),
    );
    expect(res.status).toBe(401);
  });
  it("cross-origin POSTs are refused with 403, even with a cookie", async () => {
    const headers = { origin: "https://evil.example", "x-forwarded-host": "localhost:3000", cookie: `${SESSION_COOKIE}=abc`, ...json };
    for (const [handler, path] of [[logout, "logout"], [changePassword, "change-password"]] as const) {
      const res = await handler(new NextRequest(url(`/api/admin/auth/${path}`), { method: "POST", headers, body: "{}" }));
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /api/admin/auth/login input handling", () => {
  const post = (body: string, headers: Record<string, string> = { ...same, ...json }) =>
    login(new NextRequest(url("/api/admin/auth/login"), { method: "POST", headers, body }));

  it("refuses cross-origin requests", async () => {
    expect((await post("{}", { origin: "https://evil.example", "x-forwarded-host": "localhost:3000", ...json })).status).toBe(403);
  });
  it("requires JSON", async () => {
    expect((await post("a=b", { ...same, "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
  });
  it("rejects malformed JSON and non-object bodies", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
  });
  it("rejects oversized bodies", async () => {
    expect((await post(JSON.stringify({ email: "a@b.co", password: "x".repeat(10_000) }))).status).toBe(413);
  });
  it("returns field errors for missing or malformed input without revealing anything about accounts", async () => {
    const res = await post(JSON.stringify({ email: "not-an-email", password: "" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.fieldErrors.email).toBeDefined();
    expect(body.error.fieldErrors.password).toBeDefined();
  });
});
