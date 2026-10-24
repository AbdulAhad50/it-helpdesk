import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { transferIdParam } from "@/lib/route-params";
import { getTransferFull } from "@/lib/transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/transfers/[id]: one item record with its history and sync jobs. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const full = await getTransferFull(await getDb(), await transferIdParam(params));
    if (!full) throw new ApiError(404, "NOT_FOUND", "No item record found with that ID.");
    return { data: full };
  });
}
