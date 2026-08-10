import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, FileCheck2Icon } from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listExports } from "@/lib/desktop";
import { formatCount, formatDateTime } from "@/lib/format";

export function ExportsPage() {
  const exports = useQuery({ queryKey: ["exports"], queryFn: listExports });
  const records = (exports.data ?? []).reduce(
    (sum, item) => sum + item.recordCount,
    0,
  );
  return (
    <div>
      <PageHeader
        description="Protected files created from results you reviewed and selected in Search."
        title="Exports"
      />
      <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2">
        <DashboardCard>
          <CardHeader>
            <CardTitle className="font-normal text-xs">
              Exports created
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl tabular-nums">
              {exports.data?.length ?? 0}
            </p>
          </CardContent>
          <CardFooter className="rounded-none bg-background text-xs text-muted-foreground">
            Manifest included with every export
          </CardFooter>
        </DashboardCard>
        <DashboardCard>
          <CardHeader>
            <CardTitle className="font-normal text-xs">
              Records exported
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-2xl tabular-nums">
              {formatCount(records)}
            </p>
          </CardContent>
          <CardFooter className="rounded-none bg-background text-xs text-muted-foreground">
            Secret fields excluded automatically
          </CardFooter>
        </DashboardCard>
        <DashboardCard className="gap-0 md:col-span-2">
          <CardHeader className="border-b">
            <CardTitle>Export history</CardTitle>
            <CardDescription>Saved paths stay on this device.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {exports.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">Format</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead className="pe-6">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exports.data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="ps-6">
                        <Badge variant="outline">
                          {item.format.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-2xl truncate font-mono text-xs">
                        {item.destinationPath}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {item.recordCount}
                      </TableCell>
                      <TableCell className="pe-6 text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="min-h-80 rounded-none border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileCheck2Icon />
                  </EmptyMedia>
                  <EmptyTitle>No exports</EmptyTitle>
                  <EmptyDescription>
                    Select results in Search, then choose Export selected.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    nativeButton={false}
                    render={<a href="#/search" />}
                    size="sm"
                  >
                    <DownloadIcon data-icon="inline-start" />
                    Open Search
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </DashboardCard>
      </div>
    </div>
  );
}
