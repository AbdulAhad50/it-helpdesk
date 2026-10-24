import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Eye, Inbox, Plus, Search } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-page";
import { AcceptTransferDialog } from "@/components/complaints/accept-transfer-dialog";
import { Pagination } from "@/components/complaints/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TRANSFER_STATUSES } from "@/lib/constants";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getOutlets } from "@/lib/settings-service";
import { countInTransit, listTransfers } from "@/lib/transfer-service";
import { buildQuery } from "@/lib/url";
import { parseTransferListQuery } from "@/lib/validation-transfer";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Item transfers" };
export const dynamic = "force-dynamic";

const SYNC_LABEL = { pending: "Sync pending", failed: "Sync failed", needs_reconciliation: "Needs reconciliation" } as const;

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdminPage();
  const parsed = parseTransferListQuery(await searchParams);
  const q = parsed.query;
  const db = await getDb();
  const [outlets, result, counts] = await Promise.all([getOutlets(db), listTransfers(db, q), countInTransit(db)]);

  const params = { q: q.q, direction: q.direction, status: q.status, outlet: q.outlet, pageSize: q.pageSize };
  const hrefFor = (page: number) => `/admin/transfers${buildQuery(params, { page: page === 1 ? undefined : page })}`;
  if (result.items.length === 0 && result.total > 0 && q.page > result.totalPages) redirect(hrefFor(result.totalPages));
  const active = Boolean(q.q || q.status || q.outlet);
  const tabs = [
    { label: "All", direction: undefined },
    { label: "To IT", direction: "to_it" },
    { label: "From IT", direction: "from_it" },
  ] as const;
  const withCurrent = q.outlet && !outlets.includes(q.outlet) ? [...outlets, q.outlet] : outlets;
  const th = "px-3 py-2.5 text-left font-medium";

  return (
    <AdminPage title="Item transfers" breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Item transfers" }]} admin={admin}>
      <div className="flex flex-col gap-4">
        {!parsed.ok && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-pending-line bg-pending-bg p-3.5 text-sm text-pending-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Some filters in that link weren&apos;t valid, so the default view is shown.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/transfers?direction=to_it&status=In+transit" className="rounded-card border border-line bg-surface p-4 shadow-card hover:bg-mint-50">
            <div className="flex items-center justify-between"><p className="text-sm text-muted">On their way to IT</p><ArrowDownToLine className="size-4 text-pending-fg" aria-hidden /></div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-forest-900">{counts.toIt}</p>
            <p className="mt-0.5 text-xs text-muted">Waiting for you to accept</p>
          </Link>
          <Link href="/admin/transfers?direction=from_it&status=In+transit" className="rounded-card border border-line bg-surface p-4 shadow-card hover:bg-mint-50">
            <div className="flex items-center justify-between"><p className="text-sm text-muted">On their way to outlets</p><ArrowUpFromLine className="size-4 text-pending-fg" aria-hidden /></div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-forest-900">{counts.fromIt}</p>
            <p className="mt-0.5 text-xs text-muted">Waiting for delivery confirmation</p>
          </Link>
          <div className="flex items-center sm:col-span-2 lg:col-span-1 lg:justify-end">
            <Button asChild size="lg"><Link href="/admin/transfers/new"><Plus aria-hidden /> Record an item</Link></Button>
          </div>
        </div>

        <div role="group" aria-label="Direction" className="inline-flex w-fit rounded-lg border border-line-strong bg-surface p-0.5">
          {tabs.map((t) => (
            <Link key={t.label} href={`/admin/transfers${buildQuery(params, { direction: t.direction, page: undefined })}`} aria-current={q.direction === t.direction ? "true" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", q.direction === t.direction ? "bg-forest-900 text-white" : "text-muted hover:bg-mint-100 hover:text-ink")}>
              {t.label}
            </Link>
          ))}
        </div>

        <form method="get" action="/admin/transfers" className="rounded-card border border-line bg-surface p-4 shadow-card">
          {q.direction && <input type="hidden" name="direction" value={q.direction} />}
          <input type="hidden" name="pageSize" value={q.pageSize} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2">
              <label htmlFor="t-q" className="mb-1 block text-xs font-medium text-muted">Search ID, name or outlet</label>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden /><Input id="t-q" name="q" defaultValue={q.q ?? ""} maxLength={100} placeholder="e.g. Malir or B3M9" className="pl-9" /></div>
            </div>
            <div>
              <label htmlFor="t-status" className="mb-1 block text-xs font-medium text-muted">Status</label>
              <NativeSelect id="t-status" name="status" defaultValue={q.status ?? ""}><option value="">All statuses</option>{TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
            </div>
            <div>
              <label htmlFor="t-outlet" className="mb-1 block text-xs font-medium text-muted">Outlet</label>
              <NativeSelect id="t-outlet" name="outlet" defaultValue={q.outlet ?? ""}><option value="">All outlets</option>{withCurrent.map((o) => <option key={o} value={o}>{o}</option>)}</NativeSelect>
            </div>
            <div className="flex items-end gap-2">
              {active && <Button asChild variant="ghost"><Link href={`/admin/transfers${buildQuery({ direction: q.direction })}`}>Clear</Link></Button>}
              <Button type="submit">Apply</Button>
            </div>
          </div>
        </form>

        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {result.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Inbox className="size-8 text-subtle" aria-hidden />
              <p className="font-medium text-ink">{active || q.direction ? "No items match these filters" : "No items recorded yet"}</p>
              <p className="max-w-sm text-sm text-muted">Items appear here when an outlet submits the public form, or when you record one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <caption className="sr-only">Item transfers, {result.total} in total</caption>
                <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className={th}>Record ID</th><th scope="col" className={th}>Direction</th><th scope="col" className={th}>Date</th><th scope="col" className={th}>Time</th>
                    <th scope="col" className={th}>Outlet</th><th scope="col" className={th}>Name</th><th scope="col" className={th}>Contact</th>
                    <th scope="col" className={cn(th, "w-64")}>Item</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Received</th>
                    <th scope="col" className={cn(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.items.map((t) => {
                    const open = t.status === "In transit";
                    return (
                      <tr key={t.transferId} className={cn("align-top transition-colors hover:bg-mint-50", open && "bg-pending-bg/30")}>
                        <td className={cn("px-3 py-3", open && "shadow-[inset_3px_0_0_var(--color-pending-fg)]")}>
                          <Link href={`/admin/transfers/${t.transferId}`} className="font-mono text-[13px] font-semibold text-forest-800 underline-offset-2 hover:underline">{t.transferId}</Link>
                        </td>
                        <td className="px-3 py-3"><Badge tone={t.direction === "to_it" ? "normal" : "neutral"}>{t.directionLabel}</Badge></td>
                        <td className="whitespace-nowrap px-3 py-3">{t.date}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{t.time}</td>
                        <td className="px-3 py-3 font-medium">{t.outlet}</td>
                        <td className="px-3 py-3">{t.name}</td>
                        <td className="px-3 py-3 text-muted">{t.contact ?? "–"}</td>
                        <td className="px-3 py-3 text-muted" title={t.descriptionPreview}><span className="line-clamp-2">{t.descriptionPreview}</span></td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone={open ? "pending" : "resolved"} dot>{t.status}</Badge>
                            {t.syncState !== "synced" && <Badge tone={t.syncState === "pending" ? "neutral" : "critical"}>{SYNC_LABEL[t.syncState]}</Badge>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{t.receivedAt ? <>{t.receivedAt}<br /><span className="text-xs">by {t.receivedByName}</span></> : "–"}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <Button asChild size="sm" variant="secondary"><Link href={`/admin/transfers/${t.transferId}`} aria-label={`View ${t.transferId}`}><Eye aria-hidden /> View</Link></Button>
                            {open && <AcceptTransferDialog transferId={t.transferId} direction={t.direction} name={t.name} outlet={t.outlet} preview={t.descriptionPreview} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
      </div>
    </AdminPage>
  );
}
