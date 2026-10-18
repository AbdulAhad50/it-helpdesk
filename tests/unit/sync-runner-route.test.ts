import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetEnvCache } from "@/lib/env";
import { POST } from "@/app/api/internal/sync/run/route";

const SECRET = "r".repeat(40);
const call = (headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost:3000/api/internal/sync/run", { method: "POST", headers }));

beforeEach(() => {
  process.env.MONGODB_URI = "mongodb://localhost:1";
  process.env.AUTH_SECRET = "a".repeat(48);
});
afterEach(() => {
  delete process.env.SYNC_RUNNER_SECRET;
  resetEnvCache();
});

describe("POST /api/internal/sync/run authentication", () => {
  it("is disabled (503), not open, when no runner secret is configured", async () => {
    delete process.env.SYNC_RUNNER_SECRET;
    resetEnvCache();
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(503);
  });
  it("rejects missing, malformed and wrong credentials with 401", async () => {
    process.env.SYNC_RUNNER_SECRET = SECRET;
    resetEnvCache();
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
  });
});
