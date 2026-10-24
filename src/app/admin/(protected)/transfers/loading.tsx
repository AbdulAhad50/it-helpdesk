import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6" role="status" aria-label="Loading complaints">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-36 w-full" />
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  );
}
