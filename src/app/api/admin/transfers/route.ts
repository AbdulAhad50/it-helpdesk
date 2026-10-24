import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { readJsonBody } from "@/lib/request-body";
import { getOutlets } from "@/lib/settings-service";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";
import { createTransfer, listTransfers } from "@/lib/transfer-service";
import { toFieldErrors } from "@/lib/validation";
import { buildAdminTransferSchema, parseTransferListQuery } from "@/lib/validation-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/admin/transfers?q=&direction=&status=&outlet=&page=&pageSize= */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const parsed = parseTransferListQuery(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.ok) throw new ApiError(422, "VALIDATION_FAILED", "Some filters are not valid.", { fieldErrors: parsed.errors });
    return { data: await listTransfers(await getDb(), parsed.query) };
  });
}

/** POST /api/admin/transfers: IT records an item (usually going FROM IT to an outlet). */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const db = await getDb();
    const parsed = buildAdminTransferSchema(await getOutlets(db)).safeParse(await readJsonBody(req, 32 * 1024));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const { direction, ...fields } = parsed.data;
    const created = await createTransfer(db, { fields, direction, source: "admin", actorId: admin.admin.id, correlationId });
    dispatchAfterResponse(db, [created.eventId], correlationId);
    return { status: 201, data: { transferId: created.transferId, createdAt: created.createdAt.toISOString(), status: "In transit" as const, spreadsheetSync: "pending" as const } };
  });
}
