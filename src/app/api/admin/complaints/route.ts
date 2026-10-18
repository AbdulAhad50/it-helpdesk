import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { listComplaints } from "@/lib/complaint-admin-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminApi } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/complaints?q=&status=&department=&category=&priority=&from=&to=&sort=&dir=&page=&pageSize= */
export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    await requireAdminApi(req);
    const parsed = parseListQuery(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.ok) throw new ApiError(422, "VALIDATION_FAILED", "Some filters are not valid.", { fieldErrors: parsed.errors });
    return { data: await listComplaints(await getDb(), parsed.query) };
  });
}
