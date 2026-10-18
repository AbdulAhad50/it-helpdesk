import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Inbox } from "lucide-react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPLAINT_PRIORITIES } from "@/lib/constants";

// Developer-only style reference. Returns 404 in production.
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <AdminShell title="Design system" breadcrumbs={[{ label: "Dev" }, { label: "Design system" }]}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Buttons</CardTitle>
            <CardDescription>Primary actions use the forest green.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button>Save changes</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="danger">Delete</Button>
            <Button loading>Submitting</Button>
            <Button disabled>Disabled</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Badges</CardTitle>
            <CardDescription>Status and requested priority.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <StatusBadge status="Pending" />
            <StatusBadge status="Resolved" />
            {COMPLAINT_PRIORITIES.map((p) => (
              <PriorityBadge key={p} priority={p} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Form controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-name">Your name</Label>
              <Input id="ds-name" placeholder="e.g. Ayesha Khan" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-err">Contact number</Label>
              <Input id="ds-err" aria-invalid="true" defaultValue="abc" aria-describedby="ds-err-msg" />
              <p id="ds-err-msg" className="text-xs text-critical-fg">Enter a phone number or extension, like 0300 1234567 or ext 204.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-desc">Problem description</Label>
              <Textarea id="ds-desc" placeholder="What happened, and when did it start?" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loading, empty and error states</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">
              <Inbox className="size-5 text-subtle" aria-hidden />
              No complaints match these filters. Clear a filter to see more.
            </div>
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-4 text-sm text-critical-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Complaints couldn&apos;t be loaded. Check your connection and try again.
            </div>
            <div className="flex items-center gap-2 text-sm text-resolved-fg">
              <CheckCircle2 className="size-4" aria-hidden /> Saved · <Clock className="size-4" aria-hidden /> Sheet sync pending
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
