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
import { NativeSelect } from "@/components/ui/native-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIRECTION_LABEL, TRANSFER_DIRECTIONS, TRANSFER_LIMITS } from "@/lib/constants";
import { submitTransfer } from "@/lib/transfer-client";
import {
  buildAdminTransferSchema,
  buildPublicTransferSchema,
  type AdminTransferFormInput,
  type PublicTransferFormInput,
} from "@/lib/validation-transfer";
import { cn } from "@/lib/utils";

type Values = PublicTransferFormInput & { direction?: AdminTransferFormInput["direction"] };
type Mode = "public" | "admin";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} role="alert" className="text-sm text-critical-fg">{message}</p> : null;
}

/**
 * One form, two entry points. "public": an outlet tells IT it is sending an item (everything required).
 * "admin": IT records an item going out to (or in from) an outlet (email and contact optional).
 */
export function TransferForm({ mode, outlets }: { mode: Mode; outlets: readonly string[] }) {
  const router = useRouter();
  const admin = mode === "admin";
  const schema = useMemo(() => (admin ? buildAdminTransferSchema(outlets) : buildPublicTransferSchema(outlets)), [admin, outlets]);
  const inFlight = useRef(false);
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
  } = useForm<Values, unknown, never>({
    resolver: zodResolver(schema as never),
    defaultValues: { name: "", email: "", contact: "", outlet: "", description: "", ...(admin ? { direction: "from_it" as const } : {}) },
    mode: "onTouched",
  });

  const description = watch("description") ?? "";
  const remaining = TRANSFER_LIMITS.descriptionMax - description.length;
  const direction = watch("direction") ?? (admin ? "from_it" : "to_it");
  const fromIt = admin && direction === "from_it";
  const describedBy = (n: keyof Values, extra?: string) => [errors[n] ? `${n}-error` : null, extra].filter(Boolean).join(" ") || undefined;

  async function onSubmit(values: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    const result = await submitTransfer(admin ? "/api/admin/transfers" : "/api/transfers", values);

    if (result.kind === "success") {
      // Keep the lock on while navigating, so a second click can't create a duplicate record.
      router.push(admin ? `/admin/transfers/${encodeURIComponent(result.transferId)}` : `/transfer/success?id=${encodeURIComponent(result.transferId)}`);
      if (admin) toast.success(`${result.transferId} recorded`, { description: "The spreadsheet update is queued." });
      return;
    }
    inFlight.current = false;
    setSubmitting(false);
    if (result.kind === "field-errors") {
      let first: keyof Values | undefined;
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (messages[0]) {
          setError(field as keyof Values, { type: "server", message: messages[0] });
          first ??= field as keyof Values;
        }
      }
      if (first) setFocus(first);
    }
    setBanner(result.message);
    if (result.kind !== "field-errors") toast.error(result.kind === "uncertain" ? "Couldn't confirm" : "Not saved", { description: result.message });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6" aria-busy={submitting}>
      {banner && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-4 text-sm text-critical-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{banner}</p>
        </div>
      )}

      {admin && (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="direction">Direction</Label>
          <NativeSelect id="direction" {...register("direction")}>
            {TRANSFER_DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}{d === "from_it" ? " (IT sends to an outlet)" : " (outlet sent to IT)"}</option>)}
          </NativeSelect>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="outlet">Outlet</Label>
          <Controller
            control={control}
            name="outlet"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                <SelectTrigger id="outlet" ref={field.ref} onBlur={field.onBlur} aria-invalid={errors.outlet ? true : undefined} aria-describedby={describedBy("outlet")}>
                  <SelectValue placeholder="Choose the outlet" />
                </SelectTrigger>
                <SelectContent>{outlets.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            )}
          />
          <FieldError id="outlet-error" message={errors.outlet?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{fromIt ? "Recipient name" : admin ? "Sender name" : "Your name"}</Label>
          <Input id="name" autoComplete="name" placeholder="e.g. Ayesha Khan" aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy("name")} {...register("name")} />
          <FieldError id="name-error" message={errors.name?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email {admin && <span className="font-normal text-muted">(optional)</span>}</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="name@company.com" aria-invalid={errors.email ? true : undefined} aria-describedby={describedBy("email")} {...register("email")} />
          <FieldError id="email-error" message={errors.email?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact">Phone or extension {admin && <span className="font-normal text-muted">(optional)</span>}</Label>
          <Input id="contact" type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0300 1234567 or ext 204" aria-invalid={errors.contact ? true : undefined} aria-describedby={describedBy("contact")} {...register("contact")} />
          <FieldError id="contact-error" message={errors.contact?.message} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">What is the item?</Label>
        <Textarea
          id="description"
          rows={5}
          placeholder="Describe the item (make, model, serial number if any), what is wrong or why it is going, and how it was sent."
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy("description", "description-count")}
          {...register("description")}
        />
        <div className="flex items-start justify-between gap-4">
          <FieldError id="description-error" message={errors.description?.message} />
          <p id="description-count" className={cn("ml-auto shrink-0 text-xs tabular-nums", remaining < 0 ? "font-medium text-critical-fg" : remaining < 200 ? "text-pending-fg" : "text-muted")} aria-live={remaining < 200 ? "polite" : "off"}>
            {remaining < 0 ? `${-remaining} over the limit` : `${remaining.toLocaleString("en-US")} characters left`}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted">The date and time are recorded automatically when you submit.</p>

      <div className="flex items-center gap-4 border-t border-line pt-6">
        <Button type="submit" size="lg" loading={submitting}>
          {submitting ? "Saving…" : admin ? "Record item" : "Submit"}
        </Button>
        {submitting && <p className="text-sm text-muted" role="status">Saving. Please don&apos;t close this page.</p>}
      </div>
    </form>
  );
}
