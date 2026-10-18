"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, ClipboardList, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/complaints", label: "Complaints", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Admin chrome: sidebar, header with breadcrumbs and a slot for the profile menu.
 * Navigation here is cosmetic. Authorization is enforced server-side (Phase 4).
 */
export function AdminShell({
  title,
  breadcrumbs = [],
  profile,
  children,
}: {
  title: string;
  breadcrumbs?: Crumb[];
  profile?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/12 text-white" : "text-mint-200/80 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-5 text-white">
      <span className="grid size-8 place-items-center rounded-lg bg-mint-200 text-forest-900">
        <ShieldCheck className="size-4.5" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">IT Helpdesk</span>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh bg-forest-900 lg:block">
        {brand}
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-forest-950/50"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-forest-900 shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)} className="text-white hover:bg-white/10 hover:text-white">
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            {breadcrumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="text-xs text-muted">
                <ol className="flex flex-wrap items-center gap-1.5">
                  {breadcrumbs.map((c, i) => (
                    <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden>/</span>}
                      {c.href ? (
                        <Link href={c.href} className="hover:text-ink hover:underline">
                          {c.label}
                        </Link>
                      ) : (
                        <span aria-current="page">{c.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h1>
          </div>
          {profile}
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
