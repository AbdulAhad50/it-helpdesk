import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex max-w-2xl flex-col gap-6" role="status" aria-label="Loading the form">
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-6 sm:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
