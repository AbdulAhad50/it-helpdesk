import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getAuditPage } from "@/lib/complaint-admin-service";
import { isValidComplaintId } from "@/lib/complaint-id";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/audit-logs?complaintId=&page=&pageSize= (newest first) */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const sp = req.nextUrl.searchParams;
    const complaintId = sp.get("complaintId")?.toUpperCase();
    if (complaintId && !isValidComplaintId(complaintId)) throw new ApiError(422, "VALIDATION_FAILED", "That doesn't look like a complaint ID.");
    const page = Math.min(100_000, Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1));
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(sp.get("pageSize") ?? "25", 10) || 25));
    return { data: await getAuditPage(await getDb(), { complaintId: complaintId || undefined, page, pageSize }) };
  });
}
