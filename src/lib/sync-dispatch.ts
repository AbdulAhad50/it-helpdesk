import { after } from "next/server";
import type { Db } from "mongodb";
import { log, serializeError } from "@/lib/logger";
import { dispatchJobByEventId } from "@/lib/sync-service";

/**
 * After the HTTP response has been sent, try to sync these jobs once, in order. The admin never
 * waits for Google Sheets; anything that fails stays queued and is retried by the runner.
 */
export function dispatchAfterResponse(db: Db, eventIds: (string | null)[], correlationId: string): void {
  const ids = eventIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  after(async () => {
    for (const eventId of ids) {
      try {
        await dispatchJobByEventId(db, eventId);
      } catch (err) {
        log("error", "sync.dispatch_failed", { eventId, correlationId, err: serializeError(err) });
      }
    }
  });
}
