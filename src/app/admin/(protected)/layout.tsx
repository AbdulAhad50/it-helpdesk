import { requireAdminPage } from "@/lib/permissions";

// A first gate for everything under (protected). Each page ALSO calls requireAdminPage(), because
// layouts are not re-run on client-side navigation between pages.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return children;
}
