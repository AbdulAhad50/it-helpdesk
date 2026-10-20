"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submitComplaint } from "@/lib/complaint-client";
import { COMPLAINT_PRIORITIES, LIMITS, PRIORITY_HELP } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  buildComplaintInputSchema,
  type ComplaintFormInput,
  type ComplaintInput,
  type FormOptions,
} from "@/lib/validation";

type FieldName = keyof ComplaintFormInput;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-critical-fg">
      {message}
    </p>
  );
}

export function ComplaintForm({ options }: { options: FormOptions }) {
  const router = useRouter();
  const schema = useMemo(() => buildComplaintInputSchema(options), [options]);
  const inFlight = useRef(false); // synchronous guard: state updates alone can't stop a fast double-click
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<ComplaintFormInput, unknown, ComplaintInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      userName: "",
      department: "",
      problemCategory: "",
      problemDescription: "",
      priority: "Normal",
      contactNumber: "",
    },
    mode: "onTouched",
  });

  const description = watch("problemDescription") ?? "";
  const remaining = LIMITS.descriptionMax - description.length;

  async function onSubmit(values: ComplaintInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);

    const result = await submitComplaint(values);
    const result_n8n = await fetch('https://mtj.app.n8n.cloud/webhook-test/mtj-it-complaint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    });

    
    if (result.kind === "success") {
      // Keep the lock on: the page is navigating away and a second submit would create a duplicate.
      router.push(`/complaint/success?id=${encodeURIComponent(result.complaintId)}`);
      return;
    }

    inFlight.current = false;
    setSubmitting(false);

    if (result.kind === "field-errors") {
      let first: FieldName | undefined;
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages[0]) {
          setError(field as FieldName, { type: "server", message: messages[0] });
          first ??= field as FieldName;
        }
      }
      if (first) setFocus(first);
      setBanner(result.message);
      return;
    }
    setBanner(result.message);
    toast.error(result.kind === "uncertain" ? "Couldn't confirm submission" : "Complaint not submitted", {
      description: result.message,
    });
  }

  const describedBy = (name: FieldName, hint?: string) =>
    [errors[name] ? `${name}-error` : null, hint].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6" aria-busy={submitting}>
      {banner && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-4 text-sm text-critical-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{banner}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="userName">Your name</Label>
        <Input
          id="userName"
          autoComplete="name"
          placeholder="e.g. Ayesha Khan"
          aria-invalid={errors.userName ? true : undefined}
          aria-describedby={describedBy("userName")}
          {...register("userName")}
        />
        <FieldError id="userName-error" message={errors.userName?.message} />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="department">Department</Label>
          <Controller
            control={control}
            name="department"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                <SelectTrigger
                  id="department"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-invalid={errors.department ? true : undefined}
                  aria-describedby={describedBy("department")}
                >
                  <SelectValue placeholder="Choose your department" />
                </SelectTrigger>
                <SelectContent>
                  {options.departments.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError id="department-error" message={errors.department?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="problemCategory">Problem category</Label>
          <Controller
            control={control}
            name="problemCategory"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                <SelectTrigger
                  id="problemCategory"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-invalid={errors.problemCategory ? true : undefined}
                  aria-describedby={describedBy("problemCategory")}
                >
                  <SelectValue placeholder="What is the problem with?" />
                </SelectTrigger>
                <SelectContent>
                  {options.categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError id="problemCategory-error" message={errors.problemCategory?.message} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="problemDescription">What&apos;s the problem?</Label>
        <Textarea
          id="problemDescription"
          rows={6}
          placeholder="What happened, when did it start, and what have you already tried?"
          aria-invalid={errors.problemDescription ? true : undefined}
          aria-describedby={describedBy("problemDescription", "description-count")}
          {...register("problemDescription")}
        />
        <div className="flex items-start justify-between gap-4">
          <FieldError id="problemDescription-error" message={errors.problemDescription?.message} />
          <p
            id="description-count"
            className={cn("ml-auto shrink-0 text-xs tabular-nums", remaining < 0 ? "font-medium text-critical-fg" : remaining < 200 ? "text-pending-fg" : "text-muted")}
            aria-live={remaining < 200 ? "polite" : "off"}
          >
            {remaining < 0 ? `${-remaining} over the limit` : `${remaining.toLocaleString("en-US")} characters left`}
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">How urgent is it for you?</legend>
        <p className="text-sm text-muted">
          This tells IT how much the problem affects you. It doesn&apos;t set a response time, and IT may adjust it.
        </p>
        <div className="mt-1 grid gap-2.5 sm:grid-cols-2">
          {COMPLAINT_PRIORITIES.map((p) => (
            <label
              key={p}
              className="group relative flex cursor-pointer flex-col gap-0.5 rounded-lg border border-line-strong bg-surface p-3.5 transition-colors hover:border-forest-700/50 has-[:checked]:border-emerald-600 has-[:checked]:bg-mint-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-emerald-600"
            >
              <input type="radio" value={p} className="peer sr-only" {...register("priority")} />
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <span
                  aria-hidden
                  className="grid size-4 place-items-center rounded-full border border-line-strong group-has-[:checked]:border-emerald-600"
                >
                  <span className="size-2 scale-0 rounded-full bg-emerald-600 transition-transform group-has-[:checked]:scale-100" />
                </span>
                {p}
              </span>
              <span className="pl-6 text-xs leading-snug text-muted">{PRIORITY_HELP[p]}</span>
            </label>
          ))}
        </div>
        <FieldError id="priority-error" message={errors.priority?.message} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contactNumber">
          Phone or extension <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Input
          id="contactNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="e.g. ext 204 or 0300 1234567"
          className="sm:max-w-xs"
          aria-invalid={errors.contactNumber ? true : undefined}
          aria-describedby={describedBy("contactNumber", "contact-hint")}
          {...register("contactNumber")}
        />
        <p id="contact-hint" className="text-xs text-muted">Only the IT team can see this, and only to reach you about this complaint.</p>
        <FieldError id="contactNumber-error" message={errors.contactNumber?.message} />
      </div>

      <div className="flex items-center gap-4 border-t border-line pt-6">
        <Button type="submit" size="lg" loading={submitting}>
          {submitting ? "Submitting…" : "Submit complaint"}
        </Button>
        {submitting && <p className="text-sm text-muted" role="status">Sending your complaint. Please don&apos;t close this page.</p>}
      </div>
    </form>
  );
}
