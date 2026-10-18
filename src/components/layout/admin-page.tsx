import { AdminShell, type Crumb } from "@/components/layout/admin-shell";
import { ProfileMenu } from "@/components/layout/profile-menu";
import type { PublicAdmin } from "@/lib/auth";

/** Every admin page renders through this, after calling requireAdminPage(). */
export function AdminPage({
  title,
  breadcrumbs,
  admin,
  children,
}: {
  title: string;
  breadcrumbs: Crumb[];
  admin: PublicAdmin;
  children: React.ReactNode;
}) {
  return (
    <AdminShell title={title} breadcrumbs={breadcrumbs} profile={<ProfileMenu name={admin.name} email={admin.email} />}>
      {children}
    </AdminShell>
  );
}
