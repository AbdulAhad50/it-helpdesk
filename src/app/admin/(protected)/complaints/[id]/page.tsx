import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-page";
import { EditComplaintForm } from "@/components/complaints/edit-form";
import { ResolveDialog } from "@/components/complaints/resolve-dialog";
import { SyncRetryButton } from "@/components/complaints/sync-retry-button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getComplaintFull } from "@/lib/complaint-admin-service";
import { JOB_LABEL } from "@/lib/complaint-view";
import { isValidComplaintId } from "@/lib/complaint-id";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getFormOptions } from "@/lib/settings-service";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await params).id.toUpperCase() };
}


function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

export default async function ComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdminPage();
  const id = (await params).id.toUpperCase();
  if (!isValidComplaintId(id)) notFound();

  const db = await getDb();
  const [full, options] = await Promise.all([getComplaintFull(db, id), getFormOptions(db)]);
  if (!full) notFound();
  const { complaint: c, history, syncJobs } = full;
  const pending = c.status === "Pending";

  const sync = {
    synced: { icon: CheckCircle2, tone: "text-resolved-fg", title: "Synced to Google Sheets", text: c.googleSheetSyncedAt ? `Last confirmed ${c.googleSheetSyncedAt}.` : "Confirmed by n8n." },
    pending: { icon: CircleDashed, tone: "text-pending-fg", title: "Waiting to sync", text: c.syncError ?? "The spreadsheet update is queued and will be retried automatically." },
    failed: { icon: TriangleAlert, tone: "text-critical-fg", title: "Sync failed", text: c.syncError ?? "Automatic retries were used up." },
    needs_reconciliation: {
      icon: TriangleAlert,
      tone: "text-critical-fg",
      title: "Needs reconciliation",
      text: `${c.syncError ?? "The sheet and the database disagree for this complaint."} Check the sheet for a missing or duplicate row, fix it, then retry.`,
    },
  }[c.syncState];
  const SyncIcon = sync.icon;

  return (
    <AdminPage
      title={c.complaintId}
      breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Complaints", href: "/admin/complaints" }, { label: c.complaintId }]}
      admin={admin}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={c.status} />
          <PriorityBadge priority={c.priority} />
          <span className="text-sm text-muted">Last updated {c.updatedAt}</span>
          {pending && (
            <div className="ml-auto">
              <ResolveDialog
                complaintId={c.complaintId}
                userName={c.userName}
                problemCategory={c.problemCategory}
                preview={c.problemDescription}
                size="md"
                initialWorkStuckReason={c.workStuckReason}
                initialResolutionNotes={c.resolutionNotes}
              />
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader><CardTitle>Complaint</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Item label="Employee">{c.userName}</Item>
                  <Item label="Department">{c.department}</Item>
                  <Item label="Category">{c.problemCategory}</Item>
                  <Item label="Received">{c.receivedAt}</Item>
                  <Item label="Contact">{c.contactNumber ?? <span className="font-normal text-subtle">Not provided</span>}</Item>
                </dl>
                <div>
                  <p className="text-sm text-muted">Problem description</p>
                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-3.5 text-sm leading-relaxed">{c.problemDescription}</p>
                </div>
              </CardContent>
            </Card>

            {c.status === "Resolved" && (
              <Card>
                <CardHeader><CardTitle>Resolution</CardTitle><CardDescription>The resolution time is fixed once recorded.</CardDescription></CardHeader>
                <CardContent>
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                    <Item label="Resolved">{c.solvedAt}</Item>
                    <Item label="Solve duration">{c.solveDuration}</Item>
                    <Item label="Resolved by">{c.resolvedBy ?? "–"}</Item>
                  </dl>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Update details</CardTitle>
                <CardDescription>The ID, employee, description and received time can&apos;t be changed.</CardDescription>
              </CardHeader>
              <CardContent>
                <EditComplaintForm
                  key={c.version}
                  complaintId={c.complaintId}
                  version={c.version}
                  initial={{ priority: c.priority, department: c.department, problemCategory: c.problemCategory, workStuckReason: c.workStuckReason, resolutionNotes: c.resolutionNotes }}
                  departments={options.departments}
                  categories={options.categories}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader><CardTitle>Spreadsheet sync</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <SyncIcon className={`mt-0.5 size-5 shrink-0 ${sync.tone}`} aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-ink">{sync.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{sync.text}</p>
                  </div>
                </div>
                {(c.syncState === "failed" || c.syncState === "needs_reconciliation") && <div><SyncRetryButton complaintId={c.complaintId} /></div>}
                {syncJobs.length > 0 && (
                  <ul className="flex flex-col gap-2 border-t border-line pt-3 text-xs text-muted">
                    {syncJobs.map((j, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-x-3">
                        <span>{JOB_LABEL[j.type]}</span>
                        <span className="font-medium text-ink">{j.status}{j.attempts > 0 ? ` · ${j.attempts} attempt${j.attempts === 1 ? "" : "s"}` : ""}</span>
                        {j.lastError && <span className="basis-full text-critical-fg">{j.lastError}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>History</CardTitle></CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-5">
                  {history.map((h) => (
                    <li key={h.id} className="relative border-l-2 border-line pl-4">
                      <span aria-hidden className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-emerald-600" />
                      <p className="text-sm font-medium text-ink">{h.label}</p>
                      <p className="text-xs text-muted">{h.actor} · {h.at}</p>
                      {h.changes.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1 text-xs">
                          {h.changes.map((ch, i) => (
                            <li key={i} className="break-words text-muted">
                              <span className="font-medium text-ink">{ch.field}:</span> {ch.from} → {ch.to}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AdminPage>
  );
}
