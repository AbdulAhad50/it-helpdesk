import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { TransferForm } from "@/components/forms/transfer-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { log, serializeError } from "@/lib/logger";
import { getOutlets } from "@/lib/settings-service";

export const metadata: Metadata = { title: "Send an item to IT" };
export const dynamic = "force-dynamic"; // the outlet list is configurable

export default async function TransferPage() {
  let outlets: readonly string[] | null = null;
  try {
    outlets = await getOutlets();
  } catch (err) {
    log("error", "transfer_page.outlets_failed", { err: serializeError(err) });
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">Send an item to IT</h1>
        <p className="mt-2 max-w-prose text-muted">Tell IT an item is on its way so it can be looked for, received and logged. You don&apos;t need to sign in.</p>
        <Card className="mt-8">
          <CardContent className="p-5 sm:p-7">
            {outlets ? (
              <TransferForm mode="public" outlets={outlets} />
            ) : (
              <div role="alert" className="flex flex-col items-start gap-4">
                <div className="flex items-start gap-3 text-critical-fg">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <p className="text-sm">The form couldn&apos;t load. Nothing has been lost. Refresh the page in a minute, or tell IT directly.</p>
                </div>
                <Button asChild variant="secondary"><Link href="/transfer">Try again</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <aside className="lg:pt-[4.5rem]">
        <h2 className="text-sm font-semibold text-ink">What happens next</h2>
        <ol className="mt-3 flex flex-col gap-4 text-sm text-muted">
          <li>You get a record ID straight away. Write it on the package or keep it handy.</li>
          <li>When IT receives the item, an administrator confirms it in the system.</li>
          <li>IT may also log items it sends back to your outlet.</li>
        </ol>
        <p className="mt-6 text-sm text-muted">Something broken instead? <Link href="/complaint" className="font-medium text-forest-700 underline underline-offset-2">Report an IT problem</Link>.</p>
      </aside>
    </div>
  );
}
