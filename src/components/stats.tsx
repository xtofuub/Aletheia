import type {
  DatasetSummary,
  LiveSearchActivity,
  LiveSourceSummary,
  OverviewStats,
} from "@/lib/desktop";
import { formatCount } from "@/lib/format";
import { DashboardCard } from "@/components/dashboard-card";
import {
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DashboardStats({
  datasets,
  liveSearches,
  liveSources,
  stats,
}: {
  datasets: DatasetSummary[];
  liveSearches: LiveSearchActivity[];
  liveSources: LiveSourceSummary[];
  stats: OverviewStats;
}) {
  const records = datasets.reduce(
    (sum, dataset) => sum + dataset.recordCount,
    0,
  );
  const ready = datasets.filter((dataset) => dataset.status === "ready").length;
  const latestLiveMatches = liveSearches[0]?.matches ?? 0;
  const items = [
    {
      label: "Indexed records",
      value: formatCount(records),
      detailValue: formatCount(latestLiveMatches),
      detailLabel: "matches in the latest Live scan",
    },
    {
      label: "Search sources",
      value: formatCount(datasets.length + liveSources.length),
      detailValue: formatCount(liveSources.length),
      detailLabel: `Live, ${formatCount(ready)} indexed ready`,
    },
    {
      label: "Parent domains",
      value: stats.refreshing ? "—" : formatCount(stats.parentDomainCount),
      detailValue: stats.refreshing
        ? "Calculating"
        : formatCount(stats.parentDomainCount),
      detailLabel: stats.refreshing
        ? "building a fast local summary"
        : "normalized domain groups",
    },
    {
      label: "Identities",
      value: stats.refreshing ? "—" : formatCount(stats.identityGroupCount),
      detailValue: stats.refreshing
        ? "Calculating"
        : formatCount(stats.identityGroupCount),
      detailLabel: stats.refreshing
        ? "building a fast local summary"
        : "linked identity groups",
    },
  ];

  return (
    <>
      {items.map((item) => (
        <DashboardCard className="" key={item.label}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-normal text-xs tracking-wide">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-row items-center gap-2">
            <p className="font-semibold text-2xl tabular-nums">{item.value}</p>
          </CardContent>
          <CardFooter className="gap-1.5 rounded-none bg-background text-xs">
            <span className="font-mono text-foreground tabular-nums">
              {item.detailValue}
            </span>
            <span className="truncate text-muted-foreground">
              {item.detailLabel}
            </span>
          </CardFooter>
        </DashboardCard>
      ))}
    </>
  );
}
