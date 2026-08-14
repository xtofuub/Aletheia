import { cn } from "@/lib/utils";

export function DashboardSkeleton() {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px bg-border p-px lg:grid-cols-4",
        "*:min-h-48 *:w-full *:bg-background/90",
      )}
    >
      <div />
      <div />
      <div />
      <div />
      <div className="col-span-2 min-h-114!" />
      <div className="col-span-2 min-h-114!" />
      <div className="col-span-2 min-h-92! lg:col-span-2" />
      <div className="min-h-92!" />
      <div className="min-h-92!" />
    </div>
  );
}
