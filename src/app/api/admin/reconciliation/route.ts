import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { sheetsConfigFromEnv } from "@/lib/google-sheets";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLastReconciliation, runReconciliation } from "@/lib/reconcile";
import { readJsonBody } from "@/lib/request-body";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/admin/reconciliation: the last check's summary, and whether sheet read access is configured. */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    getEnv();
    return { data: { configured: sheetsConfigFromEnv() !== null, last: await getLastReconciliation(await getDb()) } };
  });
}

/** POST /api/admin/reconciliation { repair?: boolean }: compare the sheet with MongoDB; optionally queue safe repairs. */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const body = await readJsonBody(req);
    if (body.repair !== undefined && typeof body.repair !== "boolean") {
      throw new ApiError(422, "VALIDATION_FAILED", "repair must be true or false.");
    }
    const db = await getDb();
    const rl = await checkRateLimit(db, { scope: "admin-reconcile", key: admin.admin.id, limit: 6, windowSeconds: 60 * 60 });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Sheet checks are limited to a few per hour. Try again later.", { headers: { "Retry-After": String(rl.retryAfterSeconds) } });
    }
    const report = await runReconciliation(db, { adminId: admin.admin.id, correlationId, repair: body.repair === true });
    dispatchAfterResponse(db, report.eventIds.slice(0, 20), correlationId); // the rest are picked up by the retry runner
    return { data: report };
  });
}
