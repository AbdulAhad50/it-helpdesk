import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { isValidComplaintId } from "@/lib/complaint-id";
import { getConfirmation } from "@/lib/complaint-service";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/complaints/confirmation/[complaintId]. Public, limited details only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ complaintId: string }> }) {
  return handleRoute(req, async () => {
    const { complaintId } = await params;
    const id = complaintId.toUpperCase();
    if (!isValidComplaintId(id)) throw new ApiError(400, "INVALID_COMPLAINT_ID", "That doesn't look like a complaint ID.");

    const db = await getDb();
    const rl = await checkRateLimit(db, {
      scope: "complaint-confirmation",
      key: hashKey(getClientIp(req.headers)),
      limit: 60,
      windowSeconds: 15 * 60,
    });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a few minutes.", {
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      });
    }

    const found = await getConfirmation(id, db);
    if (!found) throw new ApiError(404, "NOT_FOUND", "No complaint found with that ID.");
    return { data: { ...found, receivedAt: found.receivedAt.toISOString() } };
  });
}
