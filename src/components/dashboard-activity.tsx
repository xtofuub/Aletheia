import {
  DatabaseIcon,
  DownloadIcon,
  FileSearchIcon,
  FolderIcon,
} from "lucide-react";

import type {
  DatasetSummary,
  ExportHistoryItem,
  LiveSearchActivity,
  LiveSourceSummary,
} from "@/lib/desktop";
import { formatCount, formatDateTime } from "@/lib/format";
import { DashboardCard } from "@/components/dashboard-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export function DashboardActivity({
  datasets,
  exports,
  liveSearches,
  liveSources,
}: {
  datasets: DatasetSummary[];
  exports: ExportHistoryItem[];
  liveSearches: LiveSearchActivity[];
  liveSources: LiveSourceSummary[];
}) {
  const items = [
    ...datasets.map((dataset) => ({
      id: `dataset-${dataset.id}`,
      title: `${dataset.name} · ${dataset.status}`,
      timestamp: dataset.lastIndexedAt ?? dataset.createdAt,
      icon: <DatabaseIcon />,
    })),
    ...liveSearches.map((activity) => ({
      id: `live-search-${activity.jobId}`,
      title: `${activity.sourceName} · ${formatCount(activity.matches)} Live matches`,
      timestamp: activity.completedAt,
      icon: <FileSearchIcon />,
    })),
    ...liveSources.map((source) => ({
      id: `live-source-${source.id}`,
      title: `${source.name} · Live source saved`,
      timestamp: source.createdAt,
      icon: <FolderIcon />,
    })),
    ...exports.map((item) => ({
      id: `export-${item.id}`,
      title: `${item.format.toUpperCase()} export · ${item.recordCount} records`,
      timestamp: item.createdAt,
      icon: <DownloadIcon />,
    })),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);

  return (
    <DashboardCard className="gap-0">
      <CardHeader className="border-b">
        <CardTitle>Activity</CardTitle>
        <CardDescription>Latest local workspace changes.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {items.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li
                className="flex min-h-16 items-center gap-3 px-5 py-3"
                key={item.id}
              >
                <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
                  {item.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={item.title}>
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(item.timestamp)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-56 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>No activity</EmptyTitle>
              <EmptyDescription>
                Imports, Live scans, and exports will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </DashboardCard>
  );
}
