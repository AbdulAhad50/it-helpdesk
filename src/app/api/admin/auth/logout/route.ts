import type { NextRequest } from "next/server";
import { handleRoute } from "@/lib/api";
import { clearedSessionCookie, revokeSession } from "@/lib/auth";
import { log } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/auth/logout: ends the session on the server, then clears the cookie. */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    const ctx = await requireAdminApi(req); // rejects unauthenticated callers before any other work
    const db = await getDb();
    await revokeSession(db, ctx.sessionId);
    log("info", "auth.logout", { correlationId, adminId: ctx.admin.id });
    return { data: { signedOut: true }, headers: { "Set-Cookie": clearedSessionCookie() } };
  });
}
