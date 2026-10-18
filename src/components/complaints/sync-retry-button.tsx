"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SyncRetryButton({ complaintId }: { complaintId: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/complaints/${encodeURIComponent(complaintId)}/sync`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        toast.success("Retry queued", { description: "Check back in a moment for the result." });
        router.refresh();
      } else if (res.status === 401) {
        router.replace("/admin/login");
      } else {
        toast.error("Couldn't retry", { description: body?.error?.message ?? "Please try again." });
      }
    } catch {
      toast.error("Couldn't reach the server", { description: "Check your connection and try again." });
    }
    inFlight.current = false;
    setBusy(false);
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={retry} loading={busy}>
      {!busy && <RefreshCw aria-hidden />} Retry sync
    </Button>
  );
}
