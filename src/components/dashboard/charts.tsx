"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDuration } from "@/lib/time";

const COLORS = { pending: "#c98a1b", resolved: "#1f8a63", forest: "#153d32", emerald: "#176b4d", grid: "#dce5df", axis: "#5b6b64" };
const axis = { fontSize: 12, fill: COLORS.axis };

export interface ChartData {
  overTime: { label: string; received: number; pending: number; resolved: number; avgMinutes: number | null }[];
  pending: number;
  resolved: number;
  byDepartment: { name: string; count: number }[];
  byCategory: { name: string; count: number }[];
}

function ChartCard({ title, description, label, empty, children }: { title: string; description: string; label: string; empty?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
      <p className="text-sm text-muted">{description}</p>
      <div className="mt-4 h-64" role="img" aria-label={label}>
        {empty ? <div className="grid h-full place-items-center rounded-lg border border-dashed border-line-strong text-sm text-muted">{empty}</div> : children}
      </div>
    </section>
  );
}

const compactMinutes = (m: number) => (m >= 2880 ? `${(m / 1440).toFixed(1)}d` : m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`);
const clip = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

function Horizontal({ data }: { data: { name: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={COLORS.grid} />
        <XAxis type="number" allowDecimals={false} tick={axis} stroke={COLORS.grid} />
        <YAxis type="category" dataKey="name" width={140} tick={axis} tickFormatter={clip} stroke={COLORS.grid} />
        <Tooltip cursor={{ fill: "#e8f7ef" }} />
        <Bar dataKey="count" name="Complaints" fill={COLORS.emerald} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardCharts({ data }: { data: ChartData }) {
  const total = data.pending + data.resolved;
  const hasDurations = data.overTime.some((d) => d.avgMinutes !== null);
  const status = [
    { name: "Pending", value: data.pending, color: COLORS.pending },
    { name: "Resolved", value: data.resolved, color: COLORS.resolved },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard
          title="Complaints received over time"
          description="Per day, split by current status."
          label={`Bar chart of complaints received per day. ${total} in total.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.overTime} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="label" tick={axis} stroke={COLORS.grid} minTickGap={16} />
              <YAxis allowDecimals={false} tick={axis} stroke={COLORS.grid} width={32} />
              <Tooltip cursor={{ fill: "#e8f7ef" }} />
              <Legend />
              <Bar dataKey="pending" name="Pending" stackId="s" fill={COLORS.pending} />
              <Bar dataKey="resolved" name="Resolved" stackId="s" fill={COLORS.resolved} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Pending versus resolved"
        description="Share of complaints in this range."
        label={`Donut chart: ${data.pending} pending, ${data.resolved} resolved.`}
        empty={total === 0 ? "No complaints in this range." : undefined}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={status} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="none">
              {status.map((s) => <Cell key={s.name} fill={s.color} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Average resolution time"
        description="By day received, for complaints since resolved."
        label="Line chart of the average time to resolve complaints, by day received."
        empty={hasDurations ? undefined : "No resolved complaints in this range yet."}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.overTime} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="label" tick={axis} stroke={COLORS.grid} minTickGap={16} />
            <YAxis tick={axis} stroke={COLORS.grid} width={44} tickFormatter={compactMinutes} />
            <Tooltip formatter={(v) => [formatDuration(Number(v)), "Average"]} />
            <Line type="monotone" dataKey="avgMinutes" name="Average" stroke={COLORS.forest} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Complaints by department"
        description="Top departments in this range."
        label={`Bar chart of complaints by department. ${data.byDepartment.length} departments.`}
        empty={data.byDepartment.length === 0 ? "No complaints in this range." : undefined}
      >
        <Horizontal data={data.byDepartment} />
      </ChartCard>

      <ChartCard
        title="Complaints by category"
        description="Top problem categories in this range."
        label={`Bar chart of complaints by category. ${data.byCategory.length} categories.`}
        empty={data.byCategory.length === 0 ? "No complaints in this range." : undefined}
      >
        <Horizontal data={data.byCategory} />
      </ChartCard>
    </div>
  );
}
