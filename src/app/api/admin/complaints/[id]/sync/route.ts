import type { NextRequest } from "next/server";
import { handleRoute } from "@/lib/api";
import { retryComplaintSync } from "@/lib/complaint-admin-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { complaintIdParam } from "@/lib/route-params";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/admin/complaints/[id]/sync: re-queue this complaint's failed spreadsheet syncs. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const complaintId = await complaintIdParam(params);
    const db = await getDb();
    const { eventIds } = await retryComplaintSync(db, { complaintId, adminId: admin.admin.id, correlationId });
    dispatchAfterResponse(db, eventIds, correlationId);
    return { data: { requeued: eventIds.length } };
  });
}
