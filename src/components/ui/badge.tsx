import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        pending: "border-pending-line bg-pending-bg text-pending-fg",
        resolved: "border-resolved-line bg-resolved-bg text-resolved-fg",
        critical: "border-critical-line bg-critical-bg text-critical-fg",
        high: "border-high-line bg-high-bg text-high-fg",
        normal: "border-normal-line bg-normal-bg text-normal-fg",
        low: "border-low-line bg-low-bg text-low-fg",
        neutral: "border-line bg-canvas text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

import type { ComplaintPriority, ComplaintStatus } from "@/lib/constants";

export function StatusBadge({ status }: { status: ComplaintStatus }) {
  return (
    <Badge tone={status === "Resolved" ? "resolved" : "pending"} dot>
      {status}
    </Badge>
  );
}

const priorityTone = { Low: "low", Normal: "normal", High: "high", Critical: "critical" } as const;

export function PriorityBadge({ priority }: { priority: ComplaintPriority }) {
  return <Badge tone={priorityTone[priority]}>{priority}</Badge>;
}
