import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Eye, Inbox } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-page";
import { FiltersBar } from "@/components/complaints/filters-bar";
import { Pagination } from "@/components/complaints/pagination";
import { ResolveDialog } from "@/components/complaints/resolve-dialog";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listComplaints } from "@/lib/complaint-admin-service";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getFormOptions } from "@/lib/settings-service";
import { buildQuery } from "@/lib/url";
import { parseListQuery, type RawParams, type SortField } from "@/lib/validation-admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Complaints" };
export const dynamic = "force-dynamic";

const SYNC_LABEL = { pending: "Sync pending", failed: "Sync failed", needs_reconciliation: "Needs reconciliation" } as const;

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const { admin } = await requireAdminPage();
  const parsed = parseListQuery(await searchParams);
  const query = parsed.query;

  const db = await getDb();
  const [options, result] = await Promise.all([getFormOptions(db), listComplaints(db, query)]);

  const params = {
    q: query.q, status: query.status, priority: query.priority, department: query.department, category: query.category,
    from: query.from, to: query.to, sort: query.sort, dir: query.dir, pageSize: query.pageSize,
  };
  const hrefFor = (page: number) => `/admin/complaints${buildQuery(params, { page: page === 1 ? undefined : page })}`;
  if (result.items.length === 0 && result.total > 0 && query.page > result.totalPages) redirect(hrefFor(result.totalPages));

  const sortHref = (field: SortField) => {
    const dir = query.sort === field ? (query.dir === "asc" ? "desc" : "asc") : field === "status" ? "asc" : "desc";
    return `/admin/complaints${buildQuery(params, { sort: field, dir, page: undefined })}`;
  };
  const active = Boolean(query.q || query.status || query.priority || query.department || query.category || query.from || query.to);

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => {
    const isActive = query.sort === field;
    const Icon = !isActive ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={isActive ? (query.dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left font-medium">
        <Link href={sortHref(field)} className={cn("inline-flex items-center gap-1 hover:text-ink", isActive && "text-ink")}>
          {children} <Icon className="size-3.5" aria-hidden />
        </Link>
      </th>
    );
  };
  const th = "px-3 py-2.5 text-left font-medium";

  return (
    <AdminPage title="Complaints" breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Complaints" }]} admin={admin}>
      <div className="flex flex-col gap-4">
        {!parsed.ok && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-pending-line bg-pending-bg p-3.5 text-sm text-pending-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Some filters in that link weren&apos;t valid, so the default view is shown.</p>
          </div>
        )}
        <FiltersBar query={query} options={options} active={active} />

        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {result.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Inbox className="size-8 text-subtle" aria-hidden />
              <p className="font-medium text-ink">{active ? "No complaints match these filters" : "No complaints yet"}</p>
              <p className="max-w-sm text-sm text-muted">
                {active ? "Try removing a filter or widening the dates." : "New complaints appear here as soon as an employee submits the form."}
              </p>
              {active && <Button asChild variant="secondary"><Link href="/admin/complaints">Clear filters</Link></Button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-sm">
                <caption className="sr-only">Complaints, {result.total} in total</caption>
                <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className={th}>Complaint ID</th>
                    <SortHeader field="received">Received</SortHeader>
                    <th scope="col" className={th}>Time</th>
                    <th scope="col" className={th}>Employee</th>
                    <th scope="col" className={th}>Department</th>
                    <th scope="col" className={th}>Category</th>
                    <th scope="col" className={cn(th, "w-64")}>Problem</th>
                    <SortHeader field="priority">Priority</SortHeader>
                    <SortHeader field="status">Status</SortHeader>
                    <th scope="col" className={th}>Solve time</th>
                    <th scope="col" className={th}>Work stuck</th>
                    <th scope="col" className={cn(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.items.map((c) => {
                    const pending = c.status === "Pending";
                    return (
                      <tr key={c.complaintId} className={cn("align-top transition-colors hover:bg-mint-50", pending && "bg-pending-bg/30")}>
                        <td className={cn("px-3 py-3", pending && "shadow-[inset_3px_0_0_var(--color-pending-fg)]")}>
                          <Link href={`/admin/complaints/${c.complaintId}`} className="font-mono text-[13px] font-semibold text-forest-800 underline-offset-2 hover:underline">
                            {c.complaintId}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{c.receivedDate}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{c.receivedTime}</td>
                        <td className="px-3 py-3 font-medium">{c.userName}</td>
                        <td className="px-3 py-3">{c.department}</td>
                        <td className="px-3 py-3">{c.problemCategory}</td>
                        <td className="px-3 py-3 text-muted" title={c.descriptionPreview}><span className="line-clamp-2">{c.descriptionPreview}</span></td>
                        <td className="px-3 py-3"><PriorityBadge priority={c.priority} /></td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={c.status} />
                            {c.syncState !== "synced" && (
                              <Badge tone={c.syncState === "pending" ? "neutral" : "critical"}>{SYNC_LABEL[c.syncState]}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{c.solveDuration ?? <span className="text-subtle">–</span>}</td>
                        <td className="px-3 py-3 text-muted">{c.workStuckReason ? <span className="line-clamp-2">{c.workStuckReason}</span> : <span className="text-subtle">–</span>}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <Button asChild size="sm" variant="secondary">
                              <Link href={`/admin/complaints/${c.complaintId}`} aria-label={`View and edit ${c.complaintId}`}><Eye aria-hidden /> View</Link>
                            </Button>
                            {pending && (
                              <ResolveDialog complaintId={c.complaintId} userName={c.userName} problemCategory={c.problemCategory} preview={c.descriptionPreview} />
                            )}
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
