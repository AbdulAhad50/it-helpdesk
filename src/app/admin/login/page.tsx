import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/forms/login-form";
import { getCurrentAdmin } from "@/lib/permissions";
import { safeNextPath } from "@/lib/redirect";

export const metadata: Metadata = { title: "Admin sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(next);

  // Already signed in? Skip the form. If the database is down, show the form; sign-in will explain.
  const current = await getCurrentAdmin().catch(() => null);
  if (current) redirect(target);

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-forest-900 text-mint-200">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-forest-900">IT Helpdesk admin</h1>
            <p className="text-sm text-muted">Sign in to manage complaints.</p>
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-card">
          <LoginForm next={target} />
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          Need to report a problem?{" "}
          <Link href="/complaint" className="font-medium text-forest-700 underline underline-offset-2">Go to the complaint form</Link>
        </p>
      </div>
    </div>
  );
}
