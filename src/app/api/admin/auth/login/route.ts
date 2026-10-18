import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { authenticate, createSession, sessionCookie } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { log } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { LOGIN_RATE_LIMITS } from "@/lib/session-config";
import { loginSchema } from "@/lib/validation-auth";
import { toFieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID = "Incorrect email or password.";

/** POST /api/admin/auth/login */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    assertSameOrigin(req);
    const body = await readJsonBody(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Enter your email and password.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const { email, password } = parsed.data;

    const db = await getDb();
    const ipHash = hashKey(getClientIp(req.headers));
    const emailHash = hashKey(email);

    // Two buckets: per client (stops one machine spraying many accounts) and per account
    // (stops a distributed guess at one account). Both count every attempt.
    const [byIp, byAccount] = await Promise.all([
      checkRateLimit(db, { scope: "admin-login-ip", key: ipHash, ...LOGIN_RATE_LIMITS.perIp }),
      checkRateLimit(db, { scope: "admin-login-account", key: emailHash, ...LOGIN_RATE_LIMITS.perAccount }),
    ]);
    if (!byIp.allowed || !byAccount.allowed) {
      const retry = Math.max(byIp.allowed ? 0 : byIp.retryAfterSeconds, byAccount.allowed ? 0 : byAccount.retryAfterSeconds);
      log("warn", "auth.login.rate_limited", { correlationId, ipHash });
      throw new ApiError(429, "RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.", {
        headers: { "Retry-After": String(retry) },
      });
    }

    const admin = await authenticate(db, email, password);
    if (!admin) {
      log("warn", "auth.login.failed", { correlationId, ipHash, emailHash });
      throw new ApiError(401, "INVALID_CREDENTIALS", INVALID); // same answer for unknown email, wrong password, disabled account
    }

    const { token, expiresAt } = await createSession(db, admin._id, {
      userAgent: req.headers.get("user-agent"),
      ipHash,
    });
    log("info", "auth.login.success", { correlationId, adminId: admin._id.toHexString() });

    return {
      data: { admin: { name: admin.name, email: admin.email }, sessionExpiresAt: expiresAt.toISOString() },
      headers: { "Set-Cookie": sessionCookie(token, expiresAt) },
    };
  });
}
