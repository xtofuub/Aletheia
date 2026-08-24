import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div
      aria-label="Loading dashboard"
      className="grid grid-cols-2 gap-px bg-border p-px lg:grid-cols-4"
      role="status"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div
          className="flex min-h-40 flex-col gap-4 bg-background p-4"
          key={index}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-auto h-3 w-20" />
        </div>
      ))}
      {Array.from({ length: 2 }, (_, index) => (
        <div
          className="col-span-2 flex min-h-80 flex-col gap-5 bg-background p-5"
          key={index}
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="mt-auto h-48 w-full rounded-lg" />
        </div>
      ))}
      <div className="col-span-2 min-h-72 bg-background p-5 lg:col-span-2">
        <Skeleton className="mb-5 h-4 w-32" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="flex items-center gap-4" key={index}>
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-72 bg-background p-5">
        <Skeleton className="mb-5 h-4 w-28" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="min-h-72 bg-background p-5">
        <Skeleton className="mb-5 h-4 w-24" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="mt-4 h-20 w-full" />
      </div>
      <span className="sr-only">Loading local dashboard data</span>
    </div>
  );
}
