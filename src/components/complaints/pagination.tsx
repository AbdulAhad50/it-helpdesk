import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function pageWindow(page: number, total: number): (number | "…")[] {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("…");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const base = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm";
  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted" aria-live="polite">
        {total === 0 ? "No complaints" : `Showing ${from}–${to} of ${total.toLocaleString("en-US")}`}
      </p>
      <nav aria-label="Pagination" className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={cn(base, "border-line-strong bg-surface hover:bg-mint-50")} aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(base, "border-line text-subtle")} aria-disabled="true"><ChevronLeft className="size-4" aria-hidden /></span>
        )}
        {pageWindow(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-subtle" aria-hidden>…</span>
          ) : (
            <Link
              key={p}
              href={hrefFor(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(base, p === page ? "border-forest-900 bg-forest-900 text-white" : "border-line-strong bg-surface hover:bg-mint-50")}
            >
              {p}
            </Link>
          ),
        )}
        {page < totalPages ? (
          <Link href={hrefFor(page + 1)} className={cn(base, "border-line-strong bg-surface hover:bg-mint-50")} aria-label="Next page">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(base, "border-line text-subtle")} aria-disabled="true"><ChevronRight className="size-4" aria-hidden /></span>
        )}
      </nav>
    </div>
  );
}
