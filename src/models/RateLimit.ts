import type { Db } from "mongodb";

export interface RateLimitDoc {
  /** `${scope}:${hashedKey}:${windowStartEpochSeconds}` */
  _id: string;
  count: number;
  /** TTL index removes the document shortly after its window ends. */
  expiresAt: Date;
}

export const rateLimitsCollection = (db: Db) => db.collection<RateLimitDoc>("ratelimits");
