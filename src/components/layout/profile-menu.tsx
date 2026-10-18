"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function ProfileMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/logout", { method: "POST" });
      // 401 just means the session had already ended; either way we're signed out.
      if (!res.ok && res.status !== 401) throw new Error("logout failed");
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setBusy(false);
      toast.error("Couldn't sign out", { description: "Check your connection and try again." });
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-full bg-forest-900 text-xs font-semibold text-white transition-colors hover:bg-forest-800"
      >
        {initials(name)}
      </button>
      <div
        hidden={!open}
        className={cn("absolute right-0 top-11 z-50 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-pop")}
      >
        <div className="px-3 py-2">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <div className="my-1 border-t border-line" />
        <Link
          href="/admin/settings"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-mint-100"
        >
          <Settings className="size-4 text-muted" aria-hidden /> Settings
        </Link>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-mint-100 disabled:opacity-60"
        >
          <LogOut className="size-4 text-muted" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
