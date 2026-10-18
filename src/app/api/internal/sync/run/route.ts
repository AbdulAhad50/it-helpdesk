import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError, handleRoute } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/mongodb";
import { getQueueSummary, runDueJobs } from "@/lib/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * POST /api/internal/sync/run: retries due spreadsheet-sync jobs. Called on a schedule by n8n
 * (Workflow C). Authenticated with a dedicated secret; if no secret is configured the endpoint is
 * disabled rather than open.
 */
export async function POST(req: NextRequest) {
  return handleRoute(req, async () => {
    const secret = getEnv().SYNC_RUNNER_SECRET;
    if (!secret) throw new ApiError(503, "NOT_CONFIGURED", "The sync runner is not configured.");

    const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    // Compare fixed-length digests so neither content nor length leaks through timing.
    if (!timingSafeEqual(digest(given), digest(secret))) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid credentials.");
    }

    const db = await getDb();
    const processed = await runDueJobs(db, { max: 10, budgetMs: 40_000 });
    const queue = await getQueueSummary(db);
    return { data: { processed, queue } };
  });
}
