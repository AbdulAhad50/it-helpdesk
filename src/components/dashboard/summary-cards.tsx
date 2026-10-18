import { AlertTriangle, CheckCircle2, Clock, Inbox, Timer, type LucideIcon } from "lucide-react";
import type { DashboardMetrics } from "@/lib/dashboard-service";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

function Card({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note?: string; tone: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", tone)}><Icon className="size-4" aria-hidden /></span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-forest-900">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function SummaryCards({ m }: { m: DashboardMetrics }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Card icon={Inbox} label="Total complaints" value={m.total.toLocaleString("en-US")} tone="bg-mint-200 text-forest-900" />
      <Card icon={Clock} label="Pending" value={m.pending.toLocaleString("en-US")} tone="bg-pending-bg text-pending-fg" />
      <Card icon={CheckCircle2} label="Resolved" value={m.resolved.toLocaleString("en-US")} tone="bg-resolved-bg text-resolved-fg" />
      <Card
        icon={Timer}
        label="Average resolution time"
        value={m.avgResolutionMinutes === null ? "–" : formatDuration(m.avgResolutionMinutes)}
        note={m.avgResolutionMinutes === null ? "No resolved complaints yet" : "Resolved complaints only"}
        tone="bg-mint-200 text-forest-900"
      />
      <Card icon={AlertTriangle} label="High / Critical priority" value={m.highCritical.toLocaleString("en-US")} tone="bg-critical-bg text-critical-fg" />
    </div>
  );
}
