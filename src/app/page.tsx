import Link from "next/link";
import { ArrowRight, PackageCheck, Wrench } from "lucide-react";
import { PublicShell } from "@/components/layout/public-shell";

// The public front door: two forms. (Admins go straight to /admin/login.)
export default function HomePage() {
  const card = "group flex flex-col gap-3 rounded-card border border-line bg-surface p-6 shadow-card transition-colors hover:border-forest-700/40 hover:bg-mint-50";
  return (
    <PublicShell>
      <h1 className="text-3xl font-semibold tracking-tight text-forest-900">How can IT help?</h1>
      <p className="mt-2 max-w-prose text-muted">Choose what you need. You don&apos;t need to sign in.</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Link href="/complaint" className={card}>
          <span className="grid size-10 place-items-center rounded-lg bg-mint-200 text-forest-900"><Wrench className="size-5" aria-hidden /></span>
          <h2 className="text-lg font-semibold text-ink">Report an IT problem</h2>
          <p className="text-sm text-muted">Computer, network, printer, email, POS and anything else that isn&apos;t working.</p>
          <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-forest-700">Report a problem <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
        </Link>
        <Link href="/transfer" className={card}>
          <span className="grid size-10 place-items-center rounded-lg bg-mint-200 text-forest-900"><PackageCheck className="size-5" aria-hidden /></span>
          <h2 className="text-lg font-semibold text-ink">Send an item to IT</h2>
          <p className="text-sm text-muted">Sending equipment from an outlet to IT? Record it here so IT can receive and log it.</p>
          <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-forest-700">Record an item <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
        </Link>
      </div>
    </PublicShell>
  );
}
