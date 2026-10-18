import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ComplaintNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6">
      <SearchX className="size-6 text-subtle" aria-hidden />
      <h1 className="text-lg font-semibold text-ink">Complaint not found</h1>
      <p className="text-sm text-muted">There is no complaint with that ID. Check the ID, or find it in the list.</p>
      <Button asChild variant="secondary"><Link href="/admin/complaints">Back to complaints</Link></Button>
    </div>
  );
}
