import type { Metadata } from "next";
import { TransferForm } from "@/components/forms/transfer-form";
import { AdminPage } from "@/components/layout/admin-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getOutlets } from "@/lib/settings-service";

export const metadata: Metadata = { title: "Record an item" };
export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  const { admin } = await requireAdminPage();
  const outlets = await getOutlets(await getDb());
  return (
    <AdminPage
      title="Record an item"
      breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Item transfers", href: "/admin/transfers" }, { label: "Record an item" }]}
      admin={admin}
    >
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Record an item going to or from IT</CardTitle>
          <CardDescription>Use &ldquo;From IT&rdquo; when IT sends something to an outlet (for example a repaired item). Use &ldquo;To IT&rdquo; to log something an outlet handed over without using the public form.</CardDescription>
        </CardHeader>
        <CardContent><TransferForm mode="admin" outlets={outlets} /></CardContent>
      </Card>
    </AdminPage>
  );
}
