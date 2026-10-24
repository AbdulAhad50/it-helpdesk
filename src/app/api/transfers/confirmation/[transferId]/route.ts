import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { isValidTransferId } from "@/lib/complaint-id";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { getTransferConfirmation } from "@/lib/transfer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/transfers/confirmation/[transferId]. Public, limited details only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ transferId: string }> }) {
  return handleRoute(req, async () => {
    const id = (await params).transferId.toUpperCase();
    if (!isValidTransferId(id)) throw new ApiError(400, "INVALID_TRANSFER_ID", "That doesn't look like an item record ID.");
    const db = await getDb();
    const rl = await checkRateLimit(db, { scope: "transfer-confirmation", key: hashKey(getClientIp(req.headers)), limit: 60, windowSeconds: 15 * 60 });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a few minutes.", { headers: { "Retry-After": String(rl.retryAfterSeconds) } });
    }
    const found = await getTransferConfirmation(db, id);
    if (!found) throw new ApiError(404, "NOT_FOUND", "No item record found with that ID.");
    return { data: { ...found, createdAt: found.createdAt.toISOString() } };
  });
}
