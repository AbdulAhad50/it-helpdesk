"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPasswordPolicy, PASSWORD_MIN } from "@/lib/password-policy";
import { changePasswordSchema } from "@/lib/validation-auth";

type Values = { currentPassword: string; newPassword: string; confirmPassword: string };

export function ChangePasswordForm({ email, name }: { email: string; name: string }) {
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const schema = changePasswordSchema
    .extend({ confirmPassword: z.string().min(1, "Re-enter your new password.") })
    .superRefine((v, ctx) => {
      for (const message of checkPasswordPolicy(v.newPassword, { email, name })) {
        ctx.addIssue({ code: "custom", path: ["newPassword"], message });
      }
      if (v.newPassword !== v.confirmPassword) {
        ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "The passwords don't match." });
      }
    });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: Values) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { otherSignedOut?: number }; error?: { message?: string; fieldErrors?: Record<string, string[]> } }
        | null;

      if (res.ok) {
        reset();
        const others = body?.data?.otherSignedOut ?? 0;
        toast.success("Password changed", {
          description: others > 0 ? `${others} other session${others === 1 ? " was" : "s were"} signed out.` : undefined,
        });
      } else if (res.status === 401) {
        toast.error("Your session has ended", { description: "Sign in again to change your password." });
      } else if (body?.error?.fieldErrors) {
        for (const [field, messages] of Object.entries(body.error.fieldErrors)) {
          if (field === "currentPassword" || field === "newPassword") {
            setError(field, { type: "server", message: messages.join(" ") });
          }
        }
      } else {
        toast.error("Password not changed", { description: body?.error?.message ?? "Please try again." });
      }
    } catch {
      toast.error("Couldn't reach the server", { description: "Check your connection and try again." });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const field = (id: keyof Values, label: string, autoComplete: string, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={[errors[id] ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined}
        {...register(id)}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {errors[id] && <p id={`${id}-error`} role="alert" className="text-sm text-critical-fg">{errors[id]?.message}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-w-md flex-col gap-5" aria-busy={submitting}>
      {field("currentPassword", "Current password", "current-password")}
      {field("newPassword", "New password", "new-password", `At least ${PASSWORD_MIN} characters. Avoid common passwords and your email name.`)}
      {field("confirmPassword", "Confirm new password", "new-password")}
      <div>
        <Button type="submit" loading={submitting}>{submitting ? "Saving…" : "Change password"}</Button>
      </div>
    </form>
  );
}
