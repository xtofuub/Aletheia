import type { RouteKey } from "@/router";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const rowWidths = ["w-4/5", "w-2/3", "w-11/12", "w-3/5", "w-5/6"];

export function TableRowsSkeleton({
  className,
  rows = 6,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div
      aria-label="Loading rows"
      className={cn("divide-y", className)}
      role="status"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="grid min-h-16 grid-cols-[minmax(8rem,1.5fr)_minmax(6rem,1fr)_minmax(5rem,.65fr)] items-center gap-5 px-5"
          key={index}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton
              className={cn("h-3", rowWidths[index % rowWidths.length])}
            />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
          <Skeleton
            className={cn("h-3", rowWidths[(index + 2) % rowWidths.length])}
          />
          <Skeleton className="h-5 w-16 justify-self-end rounded-full" />
        </div>
      ))}
      <span className="sr-only">Loading local data</span>
    </div>
  );
}

export function ListRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-label="Loading list" className="flex flex-col" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex min-h-14 items-center gap-3 px-4" key={index}>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton
              className={cn("h-3", rowWidths[index % rowWidths.length])}
            />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Loading local data</span>
    </div>
  );
}

function PageHeadingSkeleton() {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-80 max-w-[62vw]" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

export function RouteSkeleton({ route }: { route: RouteKey }) {
  if (route === "overview") {
    return (
      <div>
        <PageHeadingSkeleton />
        <DashboardSkeleton />
      </div>
    );
  }

  const splitView = route === "domains" || route === "identities";
  const settingsView = route === "settings";

  return (
    <div>
      <PageHeadingSkeleton />
      <div className="mb-px grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2">
        <div className="flex min-h-32 flex-col gap-3 bg-background p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-auto h-8 w-full" />
        </div>
        <div className="flex min-h-32 flex-col gap-3 bg-background p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="mt-auto h-8 w-2/3" />
        </div>
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-px bg-border p-px",
          splitView && "lg:grid-cols-[19rem_1fr]",
          settingsView && "lg:grid-cols-2",
        )}
      >
        <div className="min-h-96 bg-background">
          {settingsView ? <TableRowsSkeleton rows={5} /> : <ListRowsSkeleton />}
        </div>
        <div className="min-h-96 bg-background">
          <TableRowsSkeleton rows={6} />
        </div>
      </div>
    </div>
  );
}

export function AppStartupSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 border-r p-4 md:flex md:flex-col md:gap-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-px w-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton
              className={cn("h-8", index === 0 ? "w-full" : "w-4/5")}
              key={index}
            />
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b px-5">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto size-8 rounded-full" />
        </header>
        <main className="mx-auto max-w-(--app-wrapper-max-width) p-4 md:p-6">
          <PageHeadingSkeleton />
          <DashboardSkeleton />
        </main>
      </div>
    </div>
  );
}
