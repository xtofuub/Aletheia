import { DatabaseIcon, DownloadIcon } from "lucide-react";

import type { DatasetSummary, ExportHistoryItem } from "@/lib/desktop";
import { formatDateTime } from "@/lib/format";
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
}: {
  datasets: DatasetSummary[];
  exports: ExportHistoryItem[];
}) {
  const items = [
    ...datasets.slice(0, 3).map((dataset) => ({
      id: `dataset-${dataset.id}`,
      title: `${dataset.name} · ${dataset.status}`,
      time: formatDateTime(dataset.lastIndexedAt ?? dataset.createdAt),
      icon: <DatabaseIcon />,
    })),
    ...exports.slice(0, 2).map((item) => ({
      id: `export-${item.id}`,
      title: `${item.format.toUpperCase()} export · ${item.recordCount} records`,
      time: formatDateTime(item.createdAt),
      icon: <DownloadIcon />,
    })),
  ].slice(0, 5);

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
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.time}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-56 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>No activity</EmptyTitle>
              <EmptyDescription>
                Imports and exports will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </DashboardCard>
  );
}
