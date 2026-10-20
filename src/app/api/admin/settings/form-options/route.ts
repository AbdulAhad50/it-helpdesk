import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { readJsonBody } from "@/lib/request-body";
import { getFormOptions, saveFormOptions } from "@/lib/settings-service";
import { toFieldErrors } from "@/lib/validation";
import { formOptionsSchema } from "@/lib/validation-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/settings/form-options */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    return { data: await getFormOptions(await getDb()) };
  });
}

/** PUT /api/admin/settings/form-options { departments: string[], categories: string[] } */
export async function PUT(req: NextRequest) {
  return handleRoute(req, async ({ correlationId }) => {
    const admin = await requireAdminApi(req);
    const parsed = formOptionsSchema.safeParse(await readJsonBody(req, 64 * 1024));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "Please fix the highlighted lists.", { fieldErrors: toFieldErrors(parsed.error) });
    }
    const saved = await saveFormOptions(await getDb(), { adminId: admin.admin.id, input: parsed.data, correlationId });
    return { data: { departments: saved.departments, categories: saved.categories } };
  });
}
