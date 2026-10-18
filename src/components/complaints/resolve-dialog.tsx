"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/lib/time";
import { RESOLUTION_NOTES_MAX, WORK_STUCK_MAX } from "@/lib/validation-admin";

interface Props {
  complaintId: string;
  userName: string;
  problemCategory: string;
  preview: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  initialWorkStuckReason?: string | null;
  initialResolutionNotes?: string | null;
}

/** Confirmation + resolution form. Uses the native <dialog>: focus is trapped and Esc closes it. */
export function ResolveDialog({ complaintId, userName, problemCategory, preview, size = "sm", variant = "primary", initialWorkStuckReason, initialResolutionNotes }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);

  function close() {
    ref.current?.close();
    setOpen(false);
    setError(null);
    setFieldErrors({});
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return; // blocks a double-click from sending two requests
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/admin/complaints/${encodeURIComponent(complaintId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workStuckReason: String(data.get("workStuckReason") ?? ""), resolutionNotes: String(data.get("resolutionNotes") ?? "") }),
      });
      const body = (await res.json().catch(() => null)) as {
        data?: { solveDurationMinutes?: number };
        error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
      } | null;

      if (res.ok) {
        const mins = body?.data?.solveDurationMinutes;
        toast.success(`${complaintId} resolved`, { description: mins === undefined ? undefined : `Solved in ${formatDuration(mins)}. Spreadsheet update is queued.` });
        close();
        router.refresh();
        return;
      }
      if (res.status === 401) {
        toast.error("Your session has ended", { description: "Sign in again to continue." });
        router.replace("/admin/login");
        return;
      }
      if (res.status === 409 && body?.error?.code === "ALREADY_RESOLVED") {
        toast.info("Already resolved", { description: "Someone else resolved this complaint first. Nothing was changed." });
        close();
        router.refresh();
        return;
      }
      if (body?.error?.fieldErrors) setFieldErrors(body.error.fieldErrors);
      setError(body?.error?.message ?? "The complaint couldn't be resolved. Please try again.");
    } catch {
      setError("Couldn't reach the server. Nothing was changed. Check your connection and try again.");
    }
    inFlight.current = false;
    setSubmitting(false);
  }

  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden /> Resolve
      </Button>
      {open && (
        <dialog
          ref={ref}
          aria-labelledby={`resolve-title-${complaintId}`}
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === ref.current && !submitting && close()}
          className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-forest-950/50"
        >
          <form onSubmit={onSubmit} className="flex flex-col gap-5 p-6">
            <div>
              <h2 id={`resolve-title-${complaintId}`} className="text-lg font-semibold tracking-tight text-forest-900">Resolve complaint</h2>
              <p className="mt-1 text-sm text-muted">
                The time is recorded now and the solve duration is calculated from when it was received. This can&apos;t be undone from here.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-canvas p-3.5 text-sm">
              <p className="font-mono font-semibold text-forest-900">{complaintId}</p>
              <p className="mt-0.5 text-muted">{userName} · {problemCategory}</p>
              <p className="mt-2 line-clamp-3 text-ink">{preview}</p>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-3 text-sm text-critical-fg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>{error}</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`stuck-${complaintId}`}>Work stuck reason <span className="font-normal text-muted">(if work was blocked)</span></Label>
              <Textarea id={`stuck-${complaintId}`} name="workStuckReason" rows={2} maxLength={WORK_STUCK_MAX} defaultValue={initialWorkStuckReason ?? ""} placeholder="e.g. Waiting for a replacement part" aria-invalid={fieldErrors.workStuckReason ? true : undefined} />
              {fieldErrors.workStuckReason && <p role="alert" className="text-sm text-critical-fg">{fieldErrors.workStuckReason[0]}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`notes-${complaintId}`}>Resolution notes</Label>
              <Textarea id={`notes-${complaintId}`} name="resolutionNotes" rows={4} maxLength={RESOLUTION_NOTES_MAX} defaultValue={initialResolutionNotes ?? ""} placeholder="What was done to fix it?" aria-invalid={fieldErrors.resolutionNotes ? true : undefined} />
              {fieldErrors.resolutionNotes && <p role="alert" className="text-sm text-critical-fg">{fieldErrors.resolutionNotes[0]}</p>}
            </div>

            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button type="button" variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
              <Button type="submit" loading={submitting}>{submitting ? "Resolving…" : `Resolve ${complaintId}`}</Button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
