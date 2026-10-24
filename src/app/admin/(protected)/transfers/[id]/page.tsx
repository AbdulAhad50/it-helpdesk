import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-page";
import { AcceptTransferDialog } from "@/components/complaints/accept-transfer-dialog";
import { SyncRetryButton } from "@/components/complaints/sync-retry-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JOB_LABEL } from "@/lib/complaint-view";
import { isValidTransferId } from "@/lib/complaint-id";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getTransferFull } from "@/lib/transfer-service";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await params).id.toUpperCase() };
}

const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-sm text-muted">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-ink">{children}</dd></div>
);

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdminPage();
  const id = (await params).id.toUpperCase();
  if (!isValidTransferId(id)) notFound();
  const full = await getTransferFull(await getDb(), id);
  if (!full) notFound();
  const { transfer: t, syncJobs } = full;
  const open = t.status === "In transit";
  const toIt = t.direction === "to_it";

  const sync = {
    synced: { icon: CheckCircle2, tone: "text-resolved-fg", title: "Synced to Google Sheets", text: t.googleSheetSyncedAt ? `Last confirmed ${t.googleSheetSyncedAt}.` : "Confirmed by n8n." },
    pending: { icon: CircleDashed, tone: "text-pending-fg", title: "Waiting to sync", text: t.syncError ?? "The spreadsheet update is queued and will be retried automatically." },
    failed: { icon: TriangleAlert, tone: "text-critical-fg", title: "Sync failed", text: t.syncError ?? "Automatic retries were used up." },
    needs_reconciliation: { icon: TriangleAlert, tone: "text-critical-fg", title: "Needs attention", text: `${t.syncError ?? "The sheet and the database disagree for this record."} Check the Item Transfers sheet for a missing or duplicate row, fix it, then retry.` },
  }[t.syncState];
  const SyncIcon = sync.icon;

  return (
    <AdminPage
      title={t.transferId}
      breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Item transfers", href: "/admin/transfers" }, { label: t.transferId }]}
      admin={admin}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={open ? "pending" : "resolved"} dot>{t.status}</Badge>
          <Badge tone={toIt ? "normal" : "neutral"}>{t.directionLabel}</Badge>
          <span className="text-sm text-muted">Recorded {t.createdAt}</span>
          {open && (
            <div className="ml-auto">
              <AcceptTransferDialog transferId={t.transferId} direction={t.direction} name={t.name} outlet={t.outlet} preview={t.description} size="md" />
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader><CardTitle>Item</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Item label="Outlet">{t.outlet}</Item>
                  <Item label={toIt ? "Sender" : "Recipient"}>{t.name}</Item>
                  <Item label="Logged by">{t.loggedBy}</Item>
                  <Item label="Contact">{t.contact ?? <span className="font-normal text-subtle">Not provided</span>}</Item>
                  <Item label="Email">{t.email ?? <span className="font-normal text-subtle">Not provided</span>}</Item>
                </dl>
                <div>
                  <p className="text-sm text-muted">Description</p>
                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-3.5 text-sm leading-relaxed">{t.description}</p>
                </div>
              </CardContent>
            </Card>

            {!open && (
              <Card>
                <CardHeader><CardTitle>{toIt ? "Received by IT" : "Delivered to the outlet"}</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Item label="Confirmed">{t.receivedAt}</Item>
                    <Item label="Confirmed by">{t.receivedByName ?? "–"}</Item>
                  </dl>
                  {t.receiptNotes && (
                    <div><p className="text-sm text-muted">Notes</p><p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-3.5 text-sm">{t.receiptNotes}</p></div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader><CardTitle>Spreadsheet sync</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <SyncIcon className={`mt-0.5 size-5 shrink-0 ${sync.tone}`} aria-hidden />
                  <div><p className="text-sm font-medium text-ink">{sync.title}</p><p className="mt-0.5 text-sm text-muted">{sync.text}</p></div>
                </div>
                {(t.syncState === "failed" || t.syncState === "needs_reconciliation") && <div><SyncRetryButton complaintId={t.transferId} endpoint={`/api/admin/transfers/${encodeURIComponent(t.transferId)}/sync`} /></div>}
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
                  {[...t.history].reverse().map((h, i) => (
                    <li key={i} className="relative border-l-2 border-line pl-4">
                      <span aria-hidden className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-emerald-600" />
                      <p className="text-sm font-medium text-ink">{h.label}</p>
                      <p className="text-xs text-muted">{h.actor} · {h.at}</p>
                      {h.note && <p className="mt-1 break-words text-xs text-muted">{h.note}</p>}
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
