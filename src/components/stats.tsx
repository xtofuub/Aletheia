import type {
  DatasetSummary,
  LiveSearchActivity,
  LiveSourceSummary,
  OverviewStats,
} from "@/lib/desktop";
import { formatCount } from "@/lib/format";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
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
      signal: latestLiveMatches,
      note: "latest live matches",
    },
    {
      label: "Search sources",
      value: formatCount(datasets.length + liveSources.length),
      signal: liveSources.length,
      note: `live · ${formatCount(ready)} indexed ready`,
    },
    {
      label: "Parent domains",
      value: formatCount(stats.parentDomainCount),
      signal: stats.parentDomainCount,
      note: "normalized groups",
    },
    {
      label: "Identities",
      value: formatCount(stats.identityGroupCount),
      signal: stats.identityGroupCount,
      note: "grouped identities",
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
          <CardFooter className="gap-1 rounded-none bg-background text-xs">
            <Delta value={item.signal}>
              <DeltaIcon />
              <DeltaValue precision={0} suffix="" />
            </Delta>
            <span className="text-muted-foreground">{item.note}</span>
          </CardFooter>
        </DashboardCard>
      ))}
    </>
  );
}
