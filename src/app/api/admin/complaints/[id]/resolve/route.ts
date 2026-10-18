import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { resolveComplaint } from "@/lib/complaint-admin-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { readJsonBody } from "@/lib/request-body";
import { complaintIdParam } from "@/lib/route-params";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";
import { toFieldErrors } from "@/lib/validation";
import { resolveSchema } from "@/lib/validation-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST /api/admin/complaints/[id]/resolve: resolve exactly this complaint, exactly once. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const complaintId = await complaintIdParam(params);
    const parsed = resolveSchema.safeParse(await readJsonBody(req, 32 * 1024));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const db = await getDb();
    const result = await resolveComplaint(db, { complaintId, adminId: admin.admin.id, input: parsed.data, correlationId });
    dispatchAfterResponse(db, [result.eventId], correlationId);
    return {
      data: {
        complaintId,
        solvedAt: result.solvedAt.toISOString(),
        solveDurationMinutes: result.solveDurationMinutes,
        // Honest: MongoDB has the resolution; the spreadsheet update has not been confirmed yet.
        spreadsheetSync: "pending" as const,
      },
    };
  });
}
