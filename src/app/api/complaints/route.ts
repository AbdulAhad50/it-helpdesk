import { after, type NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { verifyHuman } from "@/lib/abuse";
import { LIMITS, SUBMISSION_RATE_LIMIT } from "@/lib/constants";
import { createComplaint } from "@/lib/complaint-service";
import { log, serializeError } from "@/lib/logger";
import { dispatchJobByEventId } from "@/lib/sync-service";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { getFormOptions } from "@/lib/settings-service";
import { buildComplaintInputSchema, toFieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // leaves room for the background spreadsheet sync below

/** POST /api/complaints. Public: an employee submits a complaint (no login). */
export async function POST(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the complaint as JSON.");
    }
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > LIMITS.maxBodyBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That submission is too large.");
    }

    const db = await getDb();

    // Rate limit first (cheap), so abusive clients cost us as little as possible.
    const rl = await checkRateLimit(db, {
      scope: "complaint-submit",
      key: hashKey(getClientIp(req.headers)),
      ...SUBMISSION_RATE_LIMIT,
    });
    if (!rl.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many submissions from your connection. Please wait a few minutes and try again.", {
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      });
    }

    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > LIMITS.maxBodyBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That submission is too large.");
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "The submission could not be read.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiError(400, "INVALID_JSON", "The submission could not be read.");
    }

    const schema = buildComplaintInputSchema(await getFormOptions(db));
    const parsed = schema.safeParse(body); // unknown keys (e.g. status, receivedAt) are dropped
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", {
        fieldErrors: toFieldErrors(parsed.error),
      });
    }

    const token = (body as { humanToken?: unknown }).humanToken;
    if (!(await verifyHuman(req, typeof token === "string" ? token : undefined))) {
      throw new ApiError(403, "HUMAN_CHECK_FAILED", "We couldn't verify this submission. Please try again.");
    }

    const created = await createComplaint(parsed.data, { correlationId }, db);

    // After the response is sent, try the spreadsheet sync once. The employee never waits for it,
    // and if it fails or the function is cut short, the retry runner picks the job up later.
    after(async () => {
      try {
        await dispatchJobByEventId(db, `complaint.created:${created.complaintId}`);
      } catch (err) {
        log("error", "sync.dispatch_failed", { complaintId: created.complaintId, correlationId, err: serializeError(err) });
      }
    });

    return {
      status: 201,
      data: {
        complaintId: created.complaintId,
        receivedAt: created.receivedAt.toISOString(),
        status: created.status,
        // Honest state: MongoDB has it; the spreadsheet has not been confirmed yet.
        spreadsheetSync: "pending" as const,
      },
    };
  });
}
