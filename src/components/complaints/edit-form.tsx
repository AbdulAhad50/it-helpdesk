"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMPLAINT_PRIORITIES, type ComplaintPriority } from "@/lib/constants";
import { RESOLUTION_NOTES_MAX, WORK_STUCK_MAX } from "@/lib/validation-admin";

const formSchema = z.object({
  priority: z.enum(COMPLAINT_PRIORITIES),
  department: z.string().min(1, "Choose a department."),
  problemCategory: z.string().min(1, "Choose a category."),
  workStuckReason: z.string().max(WORK_STUCK_MAX, `Use ${WORK_STUCK_MAX} characters or fewer.`),
  resolutionNotes: z.string().max(RESOLUTION_NOTES_MAX, `Use ${RESOLUTION_NOTES_MAX} characters or fewer.`),
});
type Values = z.infer<typeof formSchema>;

interface Props {
  complaintId: string;
  version: number;
  initial: { priority: ComplaintPriority; department: string; problemCategory: string; workStuckReason: string | null; resolutionNotes: string | null };
  departments: readonly string[];
  categories: readonly string[];
}

/** Rendered with key={version} by the page, so it resets to fresh values after every save. */
export function EditComplaintForm({ complaintId, version, initial, departments, categories }: Props) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [stale, setStale] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const defaults: Values = {
    priority: initial.priority,
    department: initial.department,
    problemCategory: initial.problemCategory,
    workStuckReason: initial.workStuckReason ?? "",
    resolutionNotes: initial.resolutionNotes ?? "",
  };
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: defaults });

  // Keep a since-removed value selectable, so saving other fields doesn't force a change here.
  const withCurrent = (list: readonly string[], current: string) => (list.includes(current) ? list : [...list, current]);

  async function onSubmit(values: Values) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    // Send only the fields that were actually edited.
    const changed = Object.fromEntries((Object.keys(dirtyFields) as (keyof Values)[]).map((k) => [k, values[k]]));
    try {
      const res = await fetch(`/api/admin/complaints/${encodeURIComponent(complaintId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, ...changed }),
      });
      const body = (await res.json().catch(() => null)) as { data?: { changed?: boolean }; error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } } | null;

      if (res.ok) {
        toast.success(body?.data?.changed === false ? "No changes to save" : "Changes saved", {
          description: body?.data?.changed === false ? undefined : "The spreadsheet update is queued.",
        });
        router.refresh();
        return; // the page re-renders this form with the new version
      }
      if (res.status === 401) {
        toast.error("Your session has ended", { description: "Sign in again to continue." });
        router.replace("/admin/login");
        return;
      }
      if (res.status === 409 && body?.error?.code === "STALE_VERSION") {
        setStale(true);
        setBanner(body.error.message ?? "This complaint was changed by someone else.");
      } else if (body?.error?.fieldErrors) {
        for (const [f, msgs] of Object.entries(body.error.fieldErrors)) if (msgs[0]) setError(f as keyof Values, { type: "server", message: msgs[0] });
        setBanner(body.error.message ?? "Please fix the highlighted fields.");
      } else {
        setBanner(body?.error?.message ?? "The changes couldn't be saved. Please try again.");
      }
    } catch {
      setBanner("Couldn't reach the server. Nothing was saved. Check your connection and try again.");
    }
    inFlight.current = false;
    setSubmitting(false);
  }

  const err = (id: keyof Values) => errors[id] && <p id={`${id}-error`} role="alert" className="text-sm text-critical-fg">{errors[id]?.message}</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5" aria-busy={submitting}>
      {banner && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-3.5 text-sm text-critical-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col items-start gap-2">
            <p>{banner}</p>
            {stale && (
              <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()}>
                <RefreshCw aria-hidden /> Reload latest
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <NativeSelect id="priority" aria-invalid={errors.priority ? true : undefined} {...register("priority")}>
            {COMPLAINT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
          {err("priority")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="department">Department</Label>
          <NativeSelect id="department" aria-invalid={errors.department ? true : undefined} {...register("department")}>
            {withCurrent(departments, initial.department).map((d) => <option key={d} value={d}>{d}</option>)}
          </NativeSelect>
          {err("department")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="problemCategory">Category</Label>
          <NativeSelect id="problemCategory" aria-invalid={errors.problemCategory ? true : undefined} {...register("problemCategory")}>
            {withCurrent(categories, initial.problemCategory).map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
          {err("problemCategory")}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workStuckReason">Work stuck reason</Label>
        <Textarea id="workStuckReason" rows={2} placeholder="Why is work blocked, if it is?" aria-invalid={errors.workStuckReason ? true : undefined} {...register("workStuckReason")} />
        {err("workStuckReason")}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resolutionNotes">Resolution notes</Label>
        <Textarea id="resolutionNotes" rows={4} placeholder="What was done, or what has been tried so far?" aria-invalid={errors.resolutionNotes ? true : undefined} {...register("resolutionNotes")} />
        {err("resolutionNotes")}
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" loading={submitting} disabled={!isDirty || stale}>{submitting ? "Saving…" : "Save changes"}</Button>
        {!isDirty && <p className="text-sm text-muted">No unsaved changes.</p>}
      </div>
    </form>
  );
}
