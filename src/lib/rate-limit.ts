import { createHmac } from "node:crypto";
import type { Db } from "mongodb";
import { getEnv } from "@/lib/env";
import { rateLimitsCollection } from "@/models/RateLimit";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Best-effort client IP. On Vercel the first x-forwarded-for entry is the real client. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Raw IPs are never stored; only a keyed hash is. */
export function hashKey(raw: string, secret: string = getEnv().AUTH_SECRET): string {
  return createHmac("sha256", secret).update(raw).digest("hex").slice(0, 32);
}

/**
 * Fixed-window counter in MongoDB. Works across serverless instances (an in-memory limiter would
 * not). One atomic upsert-and-increment per call; a TTL index cleans up expired windows.
 */
export async function checkRateLimit(
  db: Db,
  opts: { scope: string; key: string; limit: number; windowSeconds: number; now?: Date },
): Promise<RateLimitResult> {
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStart = nowSec - (nowSec % opts.windowSeconds);
  const windowEnd = windowStart + opts.windowSeconds;
  const _id = `${opts.scope}:${opts.key}:${windowStart}`;
  const col = rateLimitsCollection(db);

  const run = () =>
    col.findOneAndUpdate(
      { _id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((windowEnd + 60) * 1000) } },
      { upsert: true, returnDocument: "after" },
    );

  let doc;
  try {
    doc = await run();
  } catch (err) {
    // Two concurrent first requests can race on the upsert; the loser retries as a plain update.
    if ((err as { code?: number }).code === 11000) doc = await run();
    else throw err;
  }

  const count = doc?.count ?? 1;
  return {
    allowed: count <= opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfterSeconds: Math.max(1, windowEnd - nowSec),
  };
}
