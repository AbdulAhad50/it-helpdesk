import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getComplaintFull, updateComplaint } from "@/lib/complaint-admin-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { readJsonBody } from "@/lib/request-body";
import { complaintIdParam } from "@/lib/route-params";
import { getFormOptions } from "@/lib/settings-service";
import { dispatchAfterResponse } from "@/lib/sync-dispatch";
import { toFieldErrors } from "@/lib/validation";
import { complaintEditSchema } from "@/lib/validation-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/complaints/[id]: one complaint with its history and sync jobs. */
export async function GET(req: NextRequest, { params }: Ctx) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const full = await getComplaintFull(await getDb(), await complaintIdParam(params));
    if (!full) throw new ApiError(404, "NOT_FOUND", "No complaint found with that ID.");
    return { data: full };
  });
}

/** PATCH /api/admin/complaints/[id]: edit permitted fields (optimistic concurrency via `version`). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const complaintId = await complaintIdParam(params);
    const parsed = complaintEditSchema.safeParse(await readJsonBody(req, 32 * 1024));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const db = await getDb();
    const result = await updateComplaint(db, {
      complaintId,
      adminId: admin.admin.id,
      input: parsed.data,
      options: await getFormOptions(db),
      correlationId,
    });
    dispatchAfterResponse(db, [result.eventId], correlationId);
    return { data: { changed: result.changed, version: result.version, spreadsheetSync: result.changed ? ("pending" as const) : null } };
  });
}
