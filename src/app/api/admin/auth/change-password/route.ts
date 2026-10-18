import { ObjectId } from "mongodb";
import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { revokeAllSessions } from "@/lib/auth";
import { log } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { requireAdminApi } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { toFieldErrors } from "@/lib/validation";
import { changePasswordSchema } from "@/lib/validation-auth";
import { adminsCollection } from "@/models/Admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/auth/change-password: signs the admin out of all OTHER sessions on success. */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    const ctx = await requireAdminApi(req); // rejects unauthenticated callers before any other work
    const db = await getDb();

    const parsed = changePasswordSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const { currentPassword, newPassword } = parsed.data;

    const rl = await checkRateLimit(db, { scope: "admin-pw-change", key: ctx.admin.id, limit: 5, windowSeconds: 15 * 60 });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Wait a few minutes and try again.", {
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      });
    }

    const admin = await adminsCollection(db).findOne({ _id: new ObjectId(ctx.admin.id) });
    if (!admin || !(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new ApiError(400, "WRONG_PASSWORD", "Please fix the highlighted fields.", {
        fieldErrors: { currentPassword: ["Current password is incorrect."] },
      });
    }

    const problems = checkPasswordPolicy(newPassword, { email: admin.email, name: admin.name });
    if (newPassword === currentPassword) problems.push("Choose a password different from your current one.");
    if (problems.length > 0) {
      throw new ApiError(422, "WEAK_PASSWORD", "Please fix the highlighted fields.", { fieldErrors: { newPassword: problems } });
    }

    await adminsCollection(db).updateOne(
      { _id: admin._id },
      { $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } },
    );
    const revoked = await revokeAllSessions(db, admin._id, ctx.sessionId);
    log("info", "auth.password_changed", { correlationId, adminId: ctx.admin.id, otherSignedOut: revoked });
    return { data: { changed: true, otherSessionsSignedOut: revoked } };
  });
}
