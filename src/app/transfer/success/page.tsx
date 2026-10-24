import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { CopyIdButton } from "@/components/complaints/copy-id-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isValidTransferId } from "@/lib/complaint-id";
import { DIRECTION_LABEL } from "@/lib/constants";
import { log, serializeError } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { formatDate, formatTime } from "@/lib/time";
import { getTransferConfirmation } from "@/lib/transfer-service";

export const metadata: Metadata = { title: "Item recorded" };
export const dynamic = "force-dynamic";

async function load(rawId?: string) {
  const id = rawId?.toUpperCase();
  if (!id || !isValidTransferId(id)) return { state: "missing" as const };
  try {
    const db = await getDb();
    const rl = await checkRateLimit(db, { scope: "transfer-confirmation", key: hashKey(getClientIp(await headers())), limit: 60, windowSeconds: 15 * 60 });
    if (!rl.allowed) return { state: "limited" as const };
    const found = await getTransferConfirmation(db, id);
    return found ? { state: "ok" as const, data: found } : { state: "missing" as const };
  } catch (err) {
    log("error", "transfer_success.load_failed", { err: serializeError(err) });
    return { state: "error" as const };
  }
}

export default async function TransferSuccessPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const result = await load((await searchParams).id);
  if (result.state !== "ok") {
    const copy = {
      missing: "We couldn't find a record with that ID. Check the ID, or submit the form again.",
      limited: "Too many lookups from your connection. Please wait a few minutes and refresh.",
      error: "We couldn't load your confirmation just now. Your record is not affected. Refresh in a minute.",
    }[result.state];
    return (
      <div className="mx-auto max-w-xl">
        <Card><CardContent className="flex flex-col items-start gap-4 p-7">
          <SearchX className="size-6 text-subtle" aria-hidden />
          <p role="alert" className="text-sm text-muted">{copy}</p>
          <Button asChild variant="secondary"><Link href="/transfer">Send an item to IT</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  const t = result.data;
  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center gap-2 text-resolved-fg">
        <CheckCircle2 className="size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">IT has been told</h1>
      </div>
      <p className="mt-2 text-muted">The item is recorded as on its way. Keep the record ID so the item can be matched when it arrives.</p>
      <Card className="mt-8">
        <CardContent className="flex flex-col gap-6 p-6">
          <div>
            <p className="text-sm text-muted">Record ID</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="select-all font-mono text-2xl font-semibold tracking-wide text-forest-900" data-testid="transfer-id">{t.transferId}</p>
              <CopyIdButton value={t.transferId} />
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-4 border-t border-line pt-5 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Recorded</dt><dd className="mt-0.5 font-medium">{formatDate(t.createdAt)} at {formatTime(t.createdAt)} (Karachi time)</dd></div>
            <div><dt className="text-muted">Status</dt><dd className="mt-1"><Badge tone="pending" dot>{t.status}</Badge></dd></div>
            <div><dt className="text-muted">Outlet</dt><dd className="mt-0.5 font-medium">{t.outlet}</dd></div>
            <div><dt className="text-muted">Direction</dt><dd className="mt-0.5 font-medium">{DIRECTION_LABEL[t.direction]}</dd></div>
          </dl>
        </CardContent>
      </Card>
      <Button asChild variant="secondary" className="mt-6"><Link href="/transfer">Record another item</Link></Button>
    </div>
  );
}
