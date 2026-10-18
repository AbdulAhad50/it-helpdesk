import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, CircleDashed, Database } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-page";
import { DashboardCharts } from "@/components/dashboard/charts";
import { RangeFilter } from "@/components/dashboard/range-filter";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardMetrics } from "@/lib/dashboard-service";
import { getIntegrationStatus } from "@/lib/env";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { resolveRange } from "@/lib/range";
import { getQueueSummary } from "@/lib/sync-service";
import { shortDayLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const Icon = ok ? CheckCircle2 : CircleDashed;
  return (
    <li className="flex items-start gap-3">
      <Icon className={ok ? "mt-0.5 size-4 text-resolved-fg" : "mt-0.5 size-4 text-pending-fg"} aria-hidden />
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
    </li>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Params }) {
  const { admin } = await requireAdminPage();
  const sp = await searchParams;
  const requested = resolveRange({ preset: one(sp.preset), from: one(sp.from), to: one(sp.to) });
  const resolved = requested.ok ? requested : resolveRange({});
  if (!resolved.ok) throw new Error("default range failed"); // unreachable: the default preset is always valid
  const range = resolved.range;

  const db = await getDb();
  const [metrics, queue] = await Promise.all([getDashboardMetrics(db, range), getQueueSummary(db)]);
  const integrations = getIntegrationStatus();
  const waiting = queue.pending + queue.processing;

  return (
    <AdminPage title="Dashboard" breadcrumbs={[{ label: "Admin" }, { label: "Dashboard" }]} admin={admin}>
      <div className="flex flex-col gap-6">
        {!requested.ok && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-pending-line bg-pending-bg p-3.5 text-sm text-pending-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{requested.error} Showing the last 30 days instead.</p>
          </div>
        )}
        <RangeFilter range={range} />
        <SummaryCards m={metrics} />
        <DashboardCharts
          data={{
            overTime: metrics.overTime.map((d) => ({ label: shortDayLabel(d.day), received: d.received, pending: d.pending, resolved: d.resolved, avgMinutes: d.avgResolutionMinutes })),
            pending: metrics.pending,
            resolved: metrics.resolved,
            byDepartment: metrics.byDepartment,
            byCategory: metrics.byCategory,
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle>System status</CardTitle>
            <CardDescription>What is connected right now (not affected by the date range).</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-3">
              <li className="flex items-start gap-3">
                <Database className="mt-0.5 size-4 text-resolved-fg" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-ink">MongoDB</p>
                  <p className="text-sm text-muted">Connected. This page just read from it.</p>
                </div>
              </li>
              <Status
                ok={integrations.n8n}
                label="n8n"
                detail={integrations.n8n ? "Webhook URLs and secret are set." : "Awaiting configuration. Complaints are stored and queued until n8n is connected."}
              />
              <Status
                ok={integrations.n8n && queue.needsAttention === 0 && waiting === 0}
                label="Spreadsheet sync"
                detail={
                  queue.needsAttention > 0
                    ? `${queue.needsAttention} job${queue.needsAttention === 1 ? "" : "s"} need attention (open the complaint to retry).`
                    : waiting > 0
                      ? `${waiting} waiting to sync${integrations.n8n ? "." : " until n8n is configured."}`
                      : `${queue.done} synced. Nothing waiting.`
                }
              />
            </ul>
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
