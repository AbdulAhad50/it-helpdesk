import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { CopyIdButton } from "@/components/complaints/copy-id-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { isValidComplaintId } from "@/lib/complaint-id";
import { getConfirmation, type ComplaintConfirmation } from "@/lib/complaint-service";
import { log, serializeError } from "@/lib/logger";
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Complaint received" };
export const dynamic = "force-dynamic";

async function load(rawId: string | undefined): Promise<
  { state: "ok"; data: ComplaintConfirmation } | { state: "missing" } | { state: "limited" } | { state: "error" }
> {
  const id = rawId?.toUpperCase();
  if (!id || !isValidComplaintId(id)) return { state: "missing" };
  try {
    const db = await getDb();
    // Same limiter as the public confirmation API, so this page can't be used to enumerate IDs.
    const rl = await checkRateLimit(db, {
      scope: "complaint-confirmation",
      key: hashKey(getClientIp(await headers())),
      limit: 60,
      windowSeconds: 15 * 60,
    });
    if (!rl.allowed) return { state: "limited" };
    const found = await getConfirmation(id, db);
    return found ? { state: "ok", data: found } : { state: "missing" };
  } catch (err) {
    log("error", "success_page.load_failed", { err: serializeError(err) });
    return { state: "error" };
  }
}

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const result = await load(id);

  if (result.state !== "ok") {
    const copy = {
      missing: "We couldn't find a complaint with that ID. Check the ID, or submit a new complaint.",
      limited: "Too many lookups from your connection. Please wait a few minutes and refresh.",
      error: "We couldn't load your confirmation just now. Your complaint is not affected. Refresh in a minute.",
    }[result.state];
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 p-7">
            <SearchX className="size-6 text-subtle" aria-hidden />
            <p role="alert" className="text-sm text-muted">{copy}</p>
            <Button asChild variant="secondary"><Link href="/complaint">Report a problem</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = result.data;
  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center gap-2 text-resolved-fg">
        <CheckCircle2 className="size-5" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">We&apos;ve received your complaint</h1>
      </div>
      <p className="mt-2 text-muted">It&apos;s saved and waiting for the IT team. Keep your complaint ID in case you need to follow up.</p>

      <Card className="mt-8">
        <CardContent className="flex flex-col gap-6 p-6">
          <div>
            <p className="text-sm text-muted">Complaint ID</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="select-all font-mono text-2xl font-semibold tracking-wide text-forest-900" data-testid="complaint-id">
                {c.complaintId}
              </p>
              <CopyIdButton value={c.complaintId} />
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-4 border-t border-line pt-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Received</dt>
              <dd className="mt-0.5 font-medium">{formatDate(c.receivedAt)} at {formatTime(c.receivedAt)} (Karachi time)</dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd className="mt-1"><StatusBadge status={c.status} /></dd>
            </div>
            <div>
              <dt className="text-muted">Category</dt>
              <dd className="mt-0.5 font-medium">{c.problemCategory}</dd>
            </div>
            <div>
              <dt className="text-muted">Requested priority</dt>
              <dd className="mt-1"><PriorityBadge priority={c.priority} /></dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Button asChild variant="secondary" className="mt-6">
        <Link href="/complaint">Report another problem</Link>
      </Button>
    </div>
  );
}
