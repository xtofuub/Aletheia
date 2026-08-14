import { useQuery } from "@tanstack/react-query";

import { BillingHealth } from "@/components/billing-health";
import { DashboardActivity } from "@/components/dashboard-activity";
import { DashboardInvoices } from "@/components/dashboard-invoices";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { DatasetLandscape } from "@/components/dataset-landscape";
import { InvestigationLanes } from "@/components/investigation-lanes";
import { DashboardStats } from "@/components/stats";
import {
  getOverviewStats,
  getSystemStatus,
  listDatasets,
  listExports,
  listLiveSearchActivity,
  listLiveSources,
} from "@/lib/desktop";

export function Dashboard() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: async () => {
      const [datasets, liveSources, liveSearches, stats, system, exports] =
        await Promise.all([
          listDatasets(),
          listLiveSources(),
          listLiveSearchActivity(),
          getOverviewStats(),
          getSystemStatus(),
          listExports(),
        ]);
      return {
        datasets,
        liveSources,
        liveSearches,
        stats,
        system,
        exports,
      };
    },
    refetchInterval: 5_000,
  });

  if (!overview.data) return <DashboardSkeleton />;

  const { datasets, liveSources, liveSearches, stats, system, exports } =
    overview.data;
  return (
    <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
      <DashboardStats
        datasets={datasets}
        liveSearches={liveSearches}
        liveSources={liveSources}
        stats={stats}
      />
      <DatasetLandscape datasets={datasets} />
      <InvestigationLanes
        datasets={datasets}
        liveSearches={liveSearches}
        liveSources={liveSources}
        stats={stats}
      />
      <DashboardInvoices datasets={datasets} liveSources={liveSources} />
      <BillingHealth system={system} />
      <DashboardActivity
        datasets={datasets}
        exports={exports}
        liveSearches={liveSearches}
        liveSources={liveSources}
      />
    </div>
  );
}
