import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]" role="status" aria-label="Loading the complaint form">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-11 w-44" />
      </div>
    </div>
  );
}
