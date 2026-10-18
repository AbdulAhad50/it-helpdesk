import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESET_LABELS, type DateRange, type RangePreset } from "@/lib/range";
import { cn } from "@/lib/utils";

const PRESETS: RangePreset[] = ["today", "7d", "30d"];

export function RangeFilter({ range }: { range: DateRange }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div role="group" aria-label="Date range" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
          {PRESETS.map((p) => (
            <Link
              key={p}
              href={`/admin/dashboard?preset=${p}`}
              aria-current={range.preset === p ? "true" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", range.preset === p ? "bg-forest-900 text-white" : "text-muted hover:bg-mint-100 hover:text-ink")}
            >
              {PRESET_LABELS[p]}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          {range.fromYmd === range.toYmd ? range.fromYmd : `${range.fromYmd} to ${range.toYmd}`} · by date received · Karachi time
        </p>
      </div>
      <form method="get" action="/admin/dashboard" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="preset" value="custom" />
        <div>
          <label htmlFor="d-from" className="mb-1 block text-xs font-medium text-muted">From</label>
          <Input id="d-from" type="date" name="from" defaultValue={range.fromYmd} required className="w-40" />
        </div>
        <div>
          <label htmlFor="d-to" className="mb-1 block text-xs font-medium text-muted">To</label>
          <Input id="d-to" type="date" name="to" defaultValue={range.toYmd} required className="w-40" />
        </div>
        <Button type="submit" variant={range.preset === "custom" ? "primary" : "secondary"}>Apply</Button>
      </form>
    </div>
  );
}
