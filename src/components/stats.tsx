import type { DatasetSummary, OverviewStats } from "@/lib/desktop";
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
  stats,
}: {
  datasets: DatasetSummary[];
  stats: OverviewStats;
}) {
  const records = datasets.reduce(
    (sum, dataset) => sum + dataset.recordCount,
    0,
  );
  const ready = datasets.filter((dataset) => dataset.status === "ready").length;
  const latestDataset = datasets
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const items = [
    {
      label: "Indexed records",
      value: formatCount(records),
      signal: latestDataset?.recordCount ?? 0,
      note: "from latest dataset",
    },
    {
      label: "Datasets",
      value: formatCount(datasets.length),
      signal: ready,
      note: "ready to search",
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
