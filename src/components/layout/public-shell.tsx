import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/** Chrome for the public (no-login) pages. Deliberately has no link into the admin area. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-forest-900">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <Link href="/complaint" className="flex items-center gap-2.5 text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-mint-200 text-forest-900">
              <ShieldCheck className="size-4.5" aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">IT Helpdesk</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
