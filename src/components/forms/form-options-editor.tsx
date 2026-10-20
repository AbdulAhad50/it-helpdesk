"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OPTION_MAX_ITEMS } from "@/lib/validation-admin";

const lines = (v: string) => v.split(/\r?\n/);

export function FormOptionsEditor({ departments, categories }: { departments: readonly string[]; categories: readonly string[] }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setBanner(null);
    setErrors({});
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/admin/settings/form-options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departments: lines(String(data.get("departments") ?? "")), categories: lines(String(data.get("categories") ?? "")) }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; fieldErrors?: Record<string, string[]> } } | null;
      if (res.ok) {
        toast.success("Form options saved", { description: "The public complaint form uses them straight away." });
        router.refresh();
      } else if (res.status === 401) {
        router.replace("/admin/login");
      } else {
        setErrors(body?.error?.fieldErrors ?? {});
        setBanner(body?.error?.message ?? "The options couldn't be saved. Please try again.");
      }
    } catch {
      setBanner("Couldn't reach the server. Nothing was saved.");
    }
    inFlight.current = false;
    setSaving(false);
  }

  const field = (name: "departments" | "categories", label: string, values: readonly string[]) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`opt-${name}`}>{label}</Label>
      <Textarea
        id={`opt-${name}`}
        name={name}
        rows={12}
        defaultValue={values.join("\n")}
        spellCheck={false}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `opt-${name}-error` : undefined}
        className="font-mono text-[13px]"
      />
      {errors[name] && <p id={`opt-${name}-error`} role="alert" className="text-sm text-critical-fg">{errors[name]!.join(" ")}</p>}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={saving}>
      <p className="text-sm text-muted">
        One per line, up to {OPTION_MAX_ITEMS} each. The order here is the order employees see. Removing an option doesn&apos;t change complaints that already use it.
      </p>
      {banner && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical-line bg-critical-bg p-3.5 text-sm text-critical-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{banner}</p>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {field("departments", "Departments", departments)}
        {field("categories", "Problem categories", categories)}
      </div>
      <div><Button type="submit" loading={saving}>{saving ? "Saving…" : "Save options"}</Button></div>
    </form>
  );
}
