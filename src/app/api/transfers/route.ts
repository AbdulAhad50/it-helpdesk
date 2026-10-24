import { after, type NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { verifyHuman } from "@/lib/abuse";
import { LIMITS, SUBMISSION_RATE_LIMIT } from "@/lib/constants";
import { log, serializeError } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { getOutlets } from "@/lib/settings-service";
import { dispatchJobByEventId } from "@/lib/sync-service";
import { createTransfer } from "@/lib/transfer-service";
import { toFieldErrors } from "@/lib/validation";
import { buildPublicTransferSchema } from "@/lib/validation-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/transfers. Public: an outlet records an item it is sending to IT (no login). */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the form as JSON.");
    }
    if (Number(req.headers.get("content-length") ?? 0) > LIMITS.maxBodyBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That submission is too large.");
    }

    const db = await getDb();
    const rl = await checkRateLimit(db, { scope: "transfer-submit", key: hashKey(getClientIp(req.headers)), ...SUBMISSION_RATE_LIMIT });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many submissions from your connection. Please wait a few minutes and try again.", {
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      });
    }

    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > LIMITS.maxBodyBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That submission is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "The submission could not be read.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ApiError(400, "INVALID_JSON", "The submission could not be read.");

    const parsed = buildPublicTransferSchema(await getOutlets(db)).safeParse(body); // unknown keys (direction, status…) are dropped
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const token = (body as { humanToken?: unknown }).humanToken;
    if (!(await verifyHuman(req, typeof token === "string" ? token : undefined))) {
      throw new ApiError(403, "HUMAN_CHECK_FAILED", "We couldn't verify this submission. Please try again.");
    }

    // The public form can only ever record items going TO IT, entered by "public".
    const created = await createTransfer(db, { fields: parsed.data, direction: "to_it", source: "public", actorId: "public", correlationId });

    after(async () => {
      try {
        await dispatchJobByEventId(db, created.eventId);
      } catch (err) {
        log("error", "sync.dispatch_failed", { eventId: created.eventId, correlationId, err: serializeError(err) });
      }
    });

    return {
      status: 201,
      data: { transferId: created.transferId, createdAt: created.createdAt.toISOString(), status: "In transit" as const, spreadsheetSync: "pending" as const },
    };
  });
}
