import type { NextRequest } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireAdminApi } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/auth/me: the signed-in administrator, or 401. */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const ctx = await requireAdminApi(req);
    return { data: { admin: ctx.admin, sessionExpiresAt: ctx.sessionExpiresAt.toISOString() } };
  });
}
