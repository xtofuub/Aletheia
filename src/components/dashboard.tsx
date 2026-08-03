import { useQuery } from "@tanstack/react-query";

import { BillingHealth } from "@/components/billing-health";
import { ChannelSalesChart } from "@/components/channel-sales-chart";
import { DashboardActivity } from "@/components/dashboard-activity";
import { DashboardInvoices } from "@/components/dashboard-invoices";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { NetRevenueChart } from "@/components/net-revenue-chart";
import { DashboardStats } from "@/components/stats";
import {
  getOverviewStats,
  getSystemStatus,
  listDatasets,
  listExports,
} from "@/lib/desktop";

export function Dashboard() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: async () => {
      const [datasets, stats, system, exports] = await Promise.all([
        listDatasets(),
        getOverviewStats(),
        getSystemStatus(),
        listExports(),
      ]);
      return { datasets, stats, system, exports };
    },
    refetchInterval: 5_000,
  });

  if (!overview.data) return <DashboardSkeleton />;

  const { datasets, stats, system, exports } = overview.data;
  return (
    <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
      <DashboardStats datasets={datasets} stats={stats} />
      <NetRevenueChart datasets={datasets} />
      <ChannelSalesChart datasets={datasets} />
      <DashboardInvoices datasets={datasets} />
      <BillingHealth system={system} />
      <DashboardActivity datasets={datasets} exports={exports} />
    </div>
  );
}
