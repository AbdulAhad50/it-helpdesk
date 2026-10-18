import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getDashboardMetrics } from "@/lib/dashboard-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { resolveRange } from "@/lib/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/dashboard?preset=today|7d|30d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const sp = req.nextUrl.searchParams;
    const r = resolveRange({ preset: sp.get("preset") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
    if (!r.ok) throw new ApiError(422, "VALIDATION_FAILED", r.error);
    const metrics = await getDashboardMetrics(await getDb(), r.range);
    return { data: { range: { preset: r.range.preset, from: r.range.fromYmd, to: r.range.toYmd, days: r.range.days }, ...metrics } };
  });
}
