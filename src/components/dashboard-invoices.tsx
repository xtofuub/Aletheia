import { ArrowRightIcon } from "lucide-react";

import type { DatasetSummary } from "@/lib/desktop";
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
}: {
  datasets: DatasetSummary[];
}) {
  const recent = datasets.slice(0, 5);
  return (
    <DashboardCard className="relative gap-0 md:col-span-2">
      <CardHeader className="border-b">
        <CardTitle>Recent datasets</CardTitle>
        <CardDescription>Newest local sources and index state.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {recent.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">Dataset</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="pe-6 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((dataset) => (
                <TableRow key={dataset.id}>
                  <TableCell className="max-w-52 truncate ps-6 font-medium">
                    {dataset.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{dataset.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatCount(dataset.recordCount)}
                  </TableCell>
                  <TableCell className="pe-6 text-right text-xs text-muted-foreground">
                    {formatDateTime(dataset.lastIndexedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty className="min-h-56 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>No datasets</EmptyTitle>
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
          View datasets
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </DashboardCard>
  );
}
