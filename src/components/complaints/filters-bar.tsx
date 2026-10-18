import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "@/lib/constants";
import type { ListQuery } from "@/lib/validation-admin";
import type { FormOptions } from "@/lib/validation";

function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

/** A plain GET form: every filter lives in the URL, so views can be bookmarked and shared. */
export function FiltersBar({ query, options, active }: { query: ListQuery; options: FormOptions; active: boolean }) {
  // Keep a configured-away value selectable so an old bookmark doesn't silently drop its filter.
  const withCurrent = (list: readonly string[], current?: string) => (current && !list.includes(current) ? [...list, current] : list);
  return (
    <form method="get" action="/admin/complaints" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <input type="hidden" name="sort" value={query.sort} />
      <input type="hidden" name="dir" value={query.dir} />
      <input type="hidden" name="pageSize" value={query.pageSize} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Search ID or employee name" htmlFor="f-q" className="sm:col-span-2 lg:col-span-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input id="f-q" name="q" defaultValue={query.q ?? ""} placeholder="e.g. A7K2 or Ayesha" className="pl-9" maxLength={100} />
          </div>
        </Field>
        <Field label="Status" htmlFor="f-status">
          <NativeSelect id="f-status" name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Priority" htmlFor="f-priority">
          <NativeSelect id="f-priority" name="priority" defaultValue={query.priority ?? ""}>
            <option value="">All priorities</option>
            {COMPLAINT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Department" htmlFor="f-department">
          <NativeSelect id="f-department" name="department" defaultValue={query.department ?? ""}>
            <option value="">All departments</option>
            {withCurrent(options.departments, query.department).map((d) => <option key={d} value={d}>{d}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Category" htmlFor="f-category">
          <NativeSelect id="f-category" name="category" defaultValue={query.category ?? ""}>
            <option value="">All categories</option>
            {withCurrent(options.categories, query.category).map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Received from" htmlFor="f-from">
          <Input id="f-from" type="date" name="from" defaultValue={query.from ?? ""} />
        </Field>
        <Field label="Received to" htmlFor="f-to">
          <Input id="f-to" type="date" name="to" defaultValue={query.to ?? ""} />
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4 lg:justify-end">
          {active && (
            <Button asChild variant="ghost">
              <Link href="/admin/complaints">Clear filters</Link>
            </Button>
          )}
          <Button type="submit">Apply filters</Button>
        </div>
      </div>
    </form>
  );
}
