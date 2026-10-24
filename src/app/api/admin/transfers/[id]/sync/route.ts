import type { NextRequest } from "next/server";
import { handleRoute } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { transferIdParam } from "@/lib/route-params";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";
import { retryTransferSync } from "@/lib/transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/admin/transfers/[id]/sync: re-queue this record's failed spreadsheet syncs. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, async ({ correlationId }) => {
    await requireAdminApi(req);
    const db = await getDb();
    const { eventIds } = await retryTransferSync(db, { transferId: await transferIdParam(params) });
    dispatchAfterResponse(db, eventIds, correlationId);
    return { data: { requeued: eventIds.length } };
  });
}
