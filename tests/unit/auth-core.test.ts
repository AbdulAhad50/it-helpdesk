import { afterEach, describe, expect, it, vi } from "vitest";
import { clearedSessionCookie, evaluateSession, hashToken, sessionCookie } from "@/lib/auth";
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS } from "@/lib/session-config";
import { safeNextPath } from "@/lib/redirect";
import { assertSameOrigin } from "@/lib/csrf";

afterEach(() => vi.unstubAllEnvs());

describe("evaluateSession", () => {
  const t0 = new Date("2026-10-18T05:00:00Z");
  const session = { lastSeenAt: t0, expiresAt: new Date(t0.getTime() + SESSION_ABSOLUTE_MS) };
  it("is valid inside both windows", () => {
    expect(evaluateSession(session, new Date(t0.getTime() + 30 * 60_000))).toBe("valid");
  });
  it("goes idle after the idle timeout", () => {
    expect(evaluateSession(session, new Date(t0.getTime() + SESSION_IDLE_MS))).toBe("idle");
  });
  it("expires at the absolute limit even if recently active", () => {
    const active = { ...session, lastSeenAt: new Date(session.expiresAt.getTime() - 1000) };
    expect(evaluateSession(active, session.expiresAt)).toBe("expired");
  });
});

describe("tokens and cookies", () => {
  it("hashes tokens deterministically without revealing them", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toContain("abc");
  });
  it("sets HttpOnly, SameSite=Lax and a Max-Age matching the expiry", () => {
    const now = new Date("2026-10-18T05:00:00Z");
    const c = sessionCookie("tok", new Date(now.getTime() + 3600_000), now);
    expect(c).toContain(`${SESSION_COOKIE}=tok`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=3600");
    expect(c).toContain("Path=/");
  });
  it("adds Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("tok", new Date(Date.now() + 1000))).toContain("Secure");
    expect(clearedSessionCookie()).toContain("Secure");
  });
  it("clears the cookie immediately", () => {
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/admin/complaints?status=Pending", "/admin/complaints?status=Pending"],
    ["/admin/settings", "/admin/settings"],
    [undefined, "/admin/dashboard"],
    ["https://evil.example", "/admin/dashboard"],
    ["//evil.example", "/admin/dashboard"],
    ["/admin//evil.example", "/admin/dashboard"],
    ["/admin/..\\evil", "/admin/dashboard"],
    ["/complaint", "/admin/dashboard"],
    ["/admin/login", "/admin/dashboard"],
    ["/admin/x\n", "/admin/dashboard"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});

describe("assertSameOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/x", { method: "POST", headers });
  it("allows a matching Origin", () => {
    expect(() => assertSameOrigin(req({ origin: "https://helpdesk.example", "x-forwarded-host": "helpdesk.example" }))).not.toThrow();
  });
  it("rejects a foreign Origin", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example", "x-forwarded-host": "helpdesk.example" }))).toThrow();
  });
  it("rejects an unparseable Origin", () => {
    expect(() => assertSameOrigin(req({ origin: "null", "x-forwarded-host": "helpdesk.example" }))).toThrow();
  });
  it("rejects cross-site fetch metadata when Origin is absent", () => {
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toThrow();
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin" }))).not.toThrow();
  });
});
