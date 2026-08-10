import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, StarIcon } from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
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
import { listSavedSearches } from "@/lib/desktop";
import { formatDateTime } from "@/lib/format";

function savedSearchHref(query: string, filtersJson: string) {
  const params = new URLSearchParams({ q: query });
  try {
    const filters = JSON.parse(filtersJson) as {
      datasetId?: string;
      field?: string;
      mode?: string;
      sourceKey?: string;
    };
    const sourceKey =
      filters.sourceKey ??
      (filters.datasetId ? `index:${filters.datasetId}` : undefined);
    if (sourceKey) params.set("source", sourceKey);
    if (filters.mode) params.set("mode", filters.mode);
    if (filters.field) params.set("field", filters.field);
  } catch {
    // Legacy saved searches may not have structured filters.
  }
  return `#/search?${params.toString()}`;
}

export function SavedViewsPage() {
  const saved = useQuery({
    queryKey: ["saved-searches"],
    queryFn: listSavedSearches,
  });
  return (
    <div>
      <PageHeader
        description="Open useful searches again with the same query and filters."
        title="Saved views"
      />
      <div className="grid grid-cols-1 gap-px bg-border p-px">
        <DashboardCard className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Search views</CardTitle>
            <CardDescription>
              {saved.data?.length ?? 0} saved queries
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {saved.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">Name</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="pe-6 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {saved.data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="ps-6 font-medium">
                        {item.name}
                      </TableCell>
                      <TableCell className="max-w-xl font-mono text-xs break-all">
                        {item.query}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </TableCell>
                      <TableCell className="pe-6 text-right">
                        <Button
                          nativeButton={false}
                          render={
                            <a
                              href={savedSearchHref(
                                item.query,
                                item.filtersJson,
                              )}
                            />
                          }
                          size="sm"
                          variant="ghost"
                        >
                          Open
                          <ArrowRightIcon data-icon="inline-end" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="min-h-80 rounded-none border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <StarIcon />
                  </EmptyMedia>
                  <EmptyTitle>No saved views</EmptyTitle>
                  <EmptyDescription>
                    Save a useful query from Search.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </DashboardCard>
      </div>
    </div>
  );
}
