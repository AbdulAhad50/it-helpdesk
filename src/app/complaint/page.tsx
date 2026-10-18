import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ComplaintForm } from "@/components/forms/complaint-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getFormOptions } from "@/lib/settings-service";
import { log, serializeError } from "@/lib/logger";
import type { FormOptions } from "@/lib/validation";

export const metadata: Metadata = { title: "Report an IT problem" };
export const dynamic = "force-dynamic"; // departments and categories are configurable at runtime

export default async function ComplaintPage() {
  let options: FormOptions | null = null;
  try {
    options = await getFormOptions();
  } catch (err) {
    log("error", "complaint_page.options_failed", { err: serializeError(err) });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">Report an IT problem</h1>
        <p className="mt-2 max-w-prose text-muted">
          Tell us what&apos;s wrong and the IT team will pick it up. You don&apos;t need to sign in.
        </p>

        <Card className="mt-8">
          <CardContent className="p-5 sm:p-7">
            {options ? (
              <ComplaintForm options={options} />
            ) : (
              <div role="alert" className="flex flex-col items-start gap-4">
                <div className="flex items-start gap-3 text-critical-fg">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <p className="text-sm">
                    The complaint form couldn&apos;t load. Nothing has been lost. Refresh the page in a minute, or tell IT in person if it&apos;s urgent.
                  </p>
                </div>
                <Button asChild variant="secondary">
                  <Link href="/complaint">Try again</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="lg:pt-[4.5rem]">
        <h2 className="text-sm font-semibold text-ink">What happens next</h2>
        <ol className="mt-3 flex flex-col gap-4 text-sm text-muted">
          <li>You get a complaint ID straight away. Keep it if you need to follow up.</li>
          <li>IT reviews complaints and may change the priority based on the wider picture.</li>
          <li>Once it&apos;s fixed, IT records how it was resolved.</li>
        </ol>
      </aside>
    </div>
  );
}
