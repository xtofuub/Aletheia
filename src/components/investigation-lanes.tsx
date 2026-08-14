import {
  ArrowUpRightIcon,
  DatabaseIcon,
  FingerprintIcon,
  FolderSearch2Icon,
  Globe2Icon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { Badge } from "@/components/ui/badge";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DatasetSummary,
  LiveSearchActivity,
  LiveSourceSummary,
  OverviewStats,
} from "@/lib/desktop";
import { formatCount } from "@/lib/format";

interface InvestigationLane {
  title: string;
  description: string;
  status: string;
  href: string;
  icon: typeof DatabaseIcon;
}

export function InvestigationLanes({
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
  const readyDatasets = datasets.filter(
    (dataset) => dataset.status === "ready",
  ).length;
  const latestLiveMatches = liveSearches[0]?.matches ?? 0;
  const lanes: InvestigationLane[] = [
    {
      title: "Indexed search",
      description: `${formatCount(readyDatasets)} of ${formatCount(datasets.length)} persistent indexes ready`,
      status: readyDatasets ? "Ready" : "Add index",
      href: "#/search",
      icon: DatabaseIcon,
    },
    {
      title: "Live scan",
      description: liveSources.length
        ? `${formatCount(liveSources.length)} saved ${liveSources.length === 1 ? "source" : "sources"} · ${formatCount(latestLiveMatches)} latest matches`
        : "Search huge files and archives without indexing",
      status: liveSources.length ? "On demand" : "Add source",
      href: "#/search",
      icon: FolderSearch2Icon,
    },
    {
      title: "Domain map",
      description: `${formatCount(stats.parentDomainCount)} normalized parent groups`,
      status: stats.parentDomainCount ? "Linked" : "Build map",
      href: "#/domains",
      icon: Globe2Icon,
    },
    {
      title: "Identity review",
      description: `${formatCount(stats.identityGroupCount)} evidence bundles`,
      status: stats.identityGroupCount ? "Reviewed" : "Build identity",
      href: "#/identities",
      icon: FingerprintIcon,
    },
  ];

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="border-b">
        <CardTitle>Investigation lanes</CardTitle>
        <CardDescription>
          Four direct routes from local files to reviewed evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-h-80 flex-1 auto-rows-fr grid-cols-1 p-0 sm:grid-cols-2">
        {lanes.map((lane, index) => {
          const Icon = lane.icon;
          return (
            <a
              className="group relative flex min-h-40 flex-col justify-between gap-6 border-b p-5 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
              href={lane.href}
              key={lane.title}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-9 items-center justify-center border bg-muted/30 text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{lane.status}</Badge>
                  <ArrowUpRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{lane.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {lane.description}
                </p>
              </div>
              <span className="absolute bottom-3 right-4 font-mono text-[10px] text-muted-foreground/50 tabular-nums">
                0{index + 1}
              </span>
            </a>
          );
        })}
      </CardContent>
    </DashboardCard>
  );
}
