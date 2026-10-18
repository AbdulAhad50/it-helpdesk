"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ComplaintsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6" role="alert">
      <AlertTriangle className="size-6 text-critical-fg" aria-hidden />
      <h1 className="text-lg font-semibold text-ink">Complaints couldn&apos;t be loaded</h1>
      <p className="text-sm text-muted">The database may be briefly unavailable. Nothing has been lost. Try again in a moment.</p>
      {error.digest && <p className="font-mono text-xs text-subtle">Reference: {error.digest}</p>}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="secondary"><Link href="/admin/dashboard">Back to dashboard</Link></Button>
      </div>
    </div>
  );
}
