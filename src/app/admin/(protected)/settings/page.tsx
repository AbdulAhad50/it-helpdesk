import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/forms/change-password-form";
import { FormOptionsEditor } from "@/components/forms/form-options-editor";
import { AdminShell } from "@/components/layout/admin-shell";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/mongodb";
import { requireAdminPage } from "@/lib/permissions";
import { getFormOptions } from "@/lib/settings-service";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { admin } = await requireAdminPage();
  const options = await getFormOptions(await getDb());
  return (
    <AdminShell
      title="Settings"
      breadcrumbs={[{ label: "Admin" }, { label: "Settings" }]}
      profile={<ProfileMenu name={admin.name} email={admin.email} />}
    >
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Name</dt><dd className="mt-0.5 font-medium">{admin.name}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="mt-0.5 font-medium">{admin.email}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Complaint form options</CardTitle>
            <CardDescription>The departments and problem categories employees can choose from.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormOptionsEditor departments={options.departments} categories={options.categories} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Changing it signs you out of every other device.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm email={admin.email} name={admin.name} />
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
