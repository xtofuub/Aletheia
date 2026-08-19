import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon, DatabaseIcon } from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { buildDatasetScaleRows } from "@/lib/dashboard-chart-data";
import type { DatasetSummary } from "@/lib/desktop";
import { formatCount } from "@/lib/format";

const VISIBLE_DATASETS = 6;

function indexStatusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Complete index";
    case "queued":
      return "Queued";
    case "indexing":
      return "Indexing";
    case "cancelling":
      return "Stopping";
    case "cancelled":
    case "interrupted":
      return "Partial index";
    case "failed":
      return "Index failed";
    default:
      return "Not indexed";
  }
}

export function DatasetLandscape({ datasets }: { datasets: DatasetSummary[] }) {
  const reduceMotion = useReducedMotion();
  const rows = buildDatasetScaleRows(datasets, VISIBLE_DATASETS);
  const totalRecords = datasets.reduce(
    (sum, dataset) => sum + dataset.recordCount,
    0,
  );

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Dataset landscape</CardTitle>
            <CardDescription>
              Largest persistent indexes by searchable record count.
            </CardDescription>
          </div>
          <Badge className="font-mono tabular-nums" variant="outline">
            {formatCount(totalRecords)} searchable
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-80 flex-col px-0 py-0">
        {rows.length ? (
          <div className="flex flex-1 flex-col divide-y divide-border">
            {rows.map((row, index) => (
              <div className="grid gap-2 px-5 py-3" key={row.id}>
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="truncate text-sm font-medium"
                      title={row.name}
                    >
                      {row.name}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {formatCount(row.records)}
                  </span>
                </div>
                <div
                  aria-label={`${row.name}: ${formatCount(row.records)} searchable rows; bar size is relative to the largest persistent index`}
                  className="h-1 overflow-hidden bg-muted"
                  role="img"
                >
                  <motion.div
                    animate={{ width: `${row.relativeScale}%` }}
                    className="h-full bg-chart-2"
                    initial={{
                      width: reduceMotion ? `${row.relativeScale}%` : 0,
                    }}
                    transition={{
                      delay: reduceMotion ? 0 : index * 0.045,
                      duration: reduceMotion ? 0 : 0.45,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {formatCount(row.files)}{" "}
                    {row.files === 1 ? "file" : "files"}
                  </span>
                  <Badge
                    title={`Dataset status: ${row.status}`}
                    variant="outline"
                  >
                    {indexStatusLabel(row.status)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="min-h-80 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DatabaseIcon />
              </EmptyMedia>
              <EmptyTitle>No persistent indexes</EmptyTitle>
              <EmptyDescription>
                Index a reusable source to map its size here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                nativeButton={false}
                render={<a href="#/datasets" />}
                size="sm"
                variant="outline"
              >
                Open Datasets
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
      {rows.length ? (
        <div className="flex items-center justify-between border-t px-5 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing {rows.length} of {datasets.length} persistent{" "}
            {datasets.length === 1 ? "source" : "sources"}
          </span>
          <Button
            nativeButton={false}
            render={<a href="#/datasets" />}
            size="sm"
            variant="ghost"
          >
            Manage sources
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      ) : null}
    </DashboardCard>
  );
}
