"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TRANSFER_LIMITS, type TransferDirection } from "@/lib/constants";

interface Props {
  transferId: string;
  direction: TransferDirection;
  name: string;
  outlet: string;
  preview: string;
  size?: ButtonProps["size"];
}

/** Confirmation + optional notes. Native <dialog>: focus is trapped and Esc closes it. */
export function AcceptTransferDialog({ transferId, direction, name, outlet, preview, size = "sm" }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toIt = direction === "to_it";
  const verb = toIt ? "Accept as received" : "Confirm delivered";

  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);

  function close() {
    ref.current?.close();
    setOpen(false);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const notes = String(new FormData(e.currentTarget).get("notes") ?? "");
    try {
      const res = await fetch(`/api/admin/transfers/${encodeURIComponent(transferId)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (res.ok) {
        toast.success(`${transferId} ${toIt ? "received" : "delivered"}`, { description: "The spreadsheet update is queued." });
        close();
        router.refresh();
        return;
      }
      if (res.status === 401) {
        toast.error("Your session has ended", { description: "Sign in again to continue." });
        router.replace("/admin/login");
        return;
      }
      if (res.status === 409 && body?.error?.code === "ALREADY_RECEIVED") {
        toast.info("Already confirmed", { description: "This item was already confirmed. Nothing was changed." });
        close();
        router.refresh();
        return;
      }
      setError(body?.error?.message ?? "Couldn't save the confirmation. Please try again.");
    } catch {
      setError("Couldn't reach the server. Nothing was changed. Check your connection and try again.");
    }
    inFlight.current = false;
    setSubmitting(false);
  }

  return (
    <>
      <Button type="button" size={size} onClick={() => setOpen(true)}>
        <PackageCheck aria-hidden /> {toIt ? "Accept" : "Confirm"}
      </Button>
      {open && (
        <dialog
          ref={ref}
          aria-labelledby={`accept-title-${transferId}`}
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === ref.current && !submitting && close()}
          className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-forest-950/50"
        >
          <form onSubmit={onSubmit} className="flex flex-col gap-5 p-6">
            <div>
              <h2 id={`accept-title-${transferId}`} className="text-lg font-semibold tracking-tight text-forest-900">
                {toIt ? "Accept item as received" : "Confirm item delivered"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {toIt ? "Confirm the item has physically arrived at IT." : `Confirm ${outlet} has received the item.`} The time is recorded now and this can&apos;t be undone from here.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-canvas p-3.5 text-sm">
              <p className="font-mono font-semibold text-forest-900">{transferId}</p>
              <p className="mt-0.5 text-muted">{outlet} · {name}</p>
              <p className="mt-2 line-clamp-3 text-ink">{preview}</p>
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-3 text-sm text-critical-fg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>{error}</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`notes-${transferId}`}>Notes <span className="font-normal text-muted">(condition, serial number checked, anything missing)</span></Label>
              <Textarea id={`notes-${transferId}`} name="notes" rows={3} maxLength={TRANSFER_LIMITS.notesMax} placeholder="Optional" />
            </div>
            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button type="button" variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
              <Button type="submit" loading={submitting}>{submitting ? "Saving…" : verb}</Button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
