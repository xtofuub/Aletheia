import { ArrowRightIcon } from "lucide-react";

import type { DatasetSummary, LiveSourceSummary } from "@/lib/desktop";
import { formatCount, formatDateTime } from "@/lib/format";
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
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DashboardInvoices({
  datasets,
  liveSources,
}: {
  datasets: DatasetSummary[];
  liveSources: LiveSourceSummary[];
}) {
  const recent = [
    ...datasets.map((dataset) => ({
      id: `dataset-${dataset.id}`,
      name: dataset.name,
      type: "Indexed",
      status: dataset.status,
      scope: `${formatCount(dataset.recordCount)} records`,
      updatedAt: dataset.lastIndexedAt ?? dataset.createdAt,
    })),
    ...liveSources.map((source) => ({
      id: `live-${source.id}`,
      name: source.name,
      type: "Live",
      status: "on demand",
      scope: `${formatCount(source.paths.length)} ${
        source.paths.length === 1 ? "location" : "locations"
      }`,
      updatedAt: source.createdAt,
    })),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return (
    <DashboardCard className="relative gap-0 md:col-span-2">
      <CardHeader className="border-b">
        <CardTitle>Recent search sources</CardTitle>
        <CardDescription>
          Persistent indexes and saved Live locations.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {recent.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">Source</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="pe-6 text-right">
                  Records / scope
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((source) => (
                <TableRow key={source.id}>
                  <TableCell className="max-w-52 ps-6">
                    <p className="truncate font-medium" title={source.name}>
                      {source.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(source.updatedAt)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={
                          source.type === "Live" ? "secondary" : "outline"
                        }
                      >
                        {source.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {source.status}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="pe-6 text-right font-mono text-xs tabular-nums">
                    {source.scope}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty className="min-h-56 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>No search sources</EmptyTitle>
              <EmptyDescription>
                Add a local source to populate the workspace.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <div className="flex justify-end border-t px-4 py-2">
        <Button
          nativeButton={false}
          render={<a href="#/datasets" />}
          size="sm"
          variant="ghost"
        >
          View sources
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </DashboardCard>
  );
}
