import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { readJsonBody } from "@/lib/request-body";
import { transferIdParam } from "@/lib/route-params";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";
import { acceptTransfer } from "@/lib/transfer-service";
import { toFieldErrors } from "@/lib/validation";
import { acceptTransferSchema } from "@/lib/validation-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/admin/transfers/[id]/accept: confirm the item arrived. Atomic and one-time. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const transferId = await transferIdParam(params);
    const parsed = acceptTransferSchema.safeParse(await readJsonBody(req, 16 * 1024));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const db = await getDb();
    const r = await acceptTransfer(db, { transferId, adminId: admin.admin.id, notes: parsed.data.notes, correlationId });
    dispatchAfterResponse(db, [r.eventId], correlationId);
    return { data: { transferId, receivedAt: r.receivedAt.toISOString(), spreadsheetSync: "pending" as const } };
  });
}
