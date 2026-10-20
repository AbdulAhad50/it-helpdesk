import type { Metadata } from "next";
import { AdminPage } from "@/components/layout/admin-page";
import { ReconcilePanel } from "@/components/complaints/reconcile-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sheetsConfigFromEnv } from "@/lib/google-sheets";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getLastReconciliation } from "@/lib/reconcile";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Sheet check" };
export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const { admin } = await requireAdminPage();
  const last = await getLastReconciliation(await getDb());
  const configured = sheetsConfigFromEnv() !== null;
  return (
    <AdminPage title="Sheet check" breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Sheet check" }]} admin={admin}>
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Compare the spreadsheet with the database</CardTitle>
            <CardDescription>
              MongoDB is the source of truth. This reads the sheet (read-only) and matches every complaint by its exact ID. Missing rows and wrong statuses can be repaired automatically; duplicate rows and unknown rows are only reported.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {last ? `Last check: ${formatDate(last.ranAt)} at ${formatTime(last.ranAt)}. ${last.result.missing + last.result.duplicates + last.result.statusMismatches === 0 ? "No problems found." : `${last.result.missing} missing, ${last.result.duplicates} duplicate, ${last.result.statusMismatches} status differences.`}` : "No check has been run yet."}
            </p>
            <ReconcilePanel configured={configured} />
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
