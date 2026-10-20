"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, GitCompareArrows } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ReconciliationReport } from "@/lib/reconcile";

function Count({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad && value > 0 ? "border-critical-line bg-critical-bg" : "border-line bg-surface"}`}>
      <dt className={`text-xs ${bad && value > 0 ? "text-critical-fg" : "text-muted"}`}>{label}</dt>
      <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${bad && value > 0 ? "text-critical-fg" : "text-forest-900"}`}>{value}</dd>
    </div>
  );
}

const Id = ({ id }: { id: string }) => (
  <Link href={`/admin/complaints/${id}`} className="font-mono text-[13px] font-semibold text-forest-800 underline-offset-2 hover:underline">{id}</Link>
);

export function ReconcilePanel({ configured }: { configured: boolean }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<"check" | "repair" | null>(null);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(repair: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(repair ? "repair" : "check");
    setError(null);
    try {
      const res = await fetch("/api/admin/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repair }) });
      const body = (await res.json().catch(() => null)) as { data?: ReconciliationReport; error?: { message?: string } } | null;
      if (res.ok && body?.data) {
        setReport(body.data);
        toast.success(repair ? `Check complete. ${body.data.repairsQueued} repair(s) queued.` : "Check complete");
        router.refresh();
      } else if (res.status === 401) {
        router.replace("/admin/login");
      } else {
        setError(body?.error?.message ?? "The check couldn't be completed. Please try again.");
      }
    } catch {
      setError("Couldn't reach the server. Nothing was changed.");
    }
    inFlight.current = false;
    setBusy(null);
  }

  const r = report;
  const problems = r ? r.missing + r.duplicates + r.statusMismatches : 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run(false)} loading={busy === "check"} disabled={!configured || busy !== null}>
          {busy !== "check" && <GitCompareArrows aria-hidden />} Run check
        </Button>
        <Button variant="secondary" onClick={() => run(true)} loading={busy === "repair"} disabled={!configured || busy !== null}>
          Run check and queue repairs
        </Button>
        {!configured && <p className="text-sm text-pending-fg">Awaiting configuration: add the Google credentials to the app&apos;s environment first.</p>}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-3.5 text-sm text-critical-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      {r && (
        <div className="flex flex-col gap-5" aria-live="polite">
          <p className={`flex items-center gap-2 text-sm font-medium ${problems === 0 ? "text-resolved-fg" : "text-critical-fg"}`}>
            {problems === 0 ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
            {problems === 0 ? "The sheet matches the database." : `${problems} complaint${problems === 1 ? "" : "s"} need attention.`}
            {r.repairsQueued > 0 && <span className="font-normal text-muted"> {r.repairsQueued} repair{r.repairsQueued === 1 ? "" : "s"} queued; they run within minutes.</span>}
          </p>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Count label="Consistent" value={r.consistent} />
            <Count label="Missing from sheet" value={r.missing} bad />
            <Count label="Duplicate rows" value={r.duplicates} bad />
            <Count label="Status differs" value={r.statusMismatches} bad />
            <Count label="Not in database" value={r.orphans} bad />
          </dl>
          <p className="text-xs text-muted">
            Checked {r.complaintsChecked} complaints against {r.sheetRows} sheet rows
            {r.skippedInFlight > 0 && `; skipped ${r.skippedInFlight} with a sync still in progress`}
            {r.unidentifiedRows > 0 && `; ${r.unidentifiedRows} sheet row(s) have no Complaint ID (rows ${r.unidentifiedRowNumbers.join(", ")})`}.
          </p>

          {r.missingIds.length > 0 && (
            <section><h3 className="text-sm font-semibold text-ink">Missing from the sheet</h3><p className="text-xs text-muted">&ldquo;Queue repairs&rdquo; re-adds these rows.</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{r.missingIds.map((id) => <li key={id}><Id id={id} /></li>)}</ul></section>
          )}
          {r.statusMismatchRows.length > 0 && (
            <section><h3 className="text-sm font-semibold text-ink">Status differs</h3><p className="text-xs text-muted">&ldquo;Queue repairs&rdquo; re-sends the current details to the existing row.</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">{r.statusMismatchRows.map((m) => <li key={m.complaintId}><Id id={m.complaintId} /> <span className="text-muted">sheet row {m.rowNumber} says {m.sheetStatus || "(blank)"}, database says {m.dbStatus}</span></li>)}</ul></section>
          )}
          {r.duplicateRows.length > 0 && (
            <section><h3 className="text-sm font-semibold text-critical-fg">Duplicate rows: fix by hand</h3><p className="text-xs text-muted">Delete the extra row(s) in Google Sheets, then run the check again. Nothing is changed automatically.</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">{r.duplicateRows.map((d) => <li key={d.complaintId}><Id id={d.complaintId} /> <span className="text-muted">rows {d.rows.join(", ")}</span></li>)}</ul></section>
          )}
          {r.orphanRows.length > 0 && (
            <section><h3 className="text-sm font-semibold text-critical-fg">In the sheet but not in the database: review by hand</h3><p className="text-xs text-muted">These may be test rows or typos. They are never deleted or imported automatically.</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">{r.orphanRows.map((o) => <li key={`${o.complaintId}-${o.rowNumber}`}><span className="font-mono text-[13px]">{o.complaintId}</span> <span className="text-muted">row {o.rowNumber}</span></li>)}</ul></section>
          )}
        </div>
      )}
    </div>
  );
}
