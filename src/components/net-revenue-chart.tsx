import { DatabaseIcon } from "lucide-react";
import { Bar, BarChart, XAxis } from "recharts";

import type { DatasetSummary } from "@/lib/desktop";
import { formatCount } from "@/lib/format";
import { DashboardCard } from "@/components/dashboard-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = {
  records: { label: "Records", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function NetRevenueChart({ datasets }: { datasets: DatasetSummary[] }) {
  const rows = datasets
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-8)
    .map((dataset) => ({
      label: dataset.name.slice(0, 12),
      records: dataset.recordCount,
    }));
  const total = datasets.reduce((sum, dataset) => sum + dataset.recordCount, 0);

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader>
        <CardTitle>Index growth</CardTitle>
        <CardDescription>
          {formatCount(total)} records across the latest persistent indexes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ChartContainer
            className="aspect-auto h-60 w-full md:h-72"
            config={chartConfig}
          >
            <BarChart accessibilityLayer data={rows}>
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={10}
              />
              <ChartTooltip
                allowEscapeViewBox={{ x: true, y: true }}
                content={
                  <ChartTooltipContent
                    className="animate-in fade-in-0 zoom-in-95 duration-150"
                    labelFormatter={(value) => String(value)}
                  />
                }
                cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
                wrapperStyle={{ zIndex: 20 }}
              />
              <Bar
                activeBar={{
                  fill: "var(--color-records)",
                  fillOpacity: 0.78,
                  stroke: "var(--foreground)",
                  strokeWidth: 1,
                }}
                dataKey="records"
                fill="var(--color-records)"
                maxBarSize={72}
                radius={2}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty className="h-60 rounded-none border-0 md:h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DatabaseIcon />
              </EmptyMedia>
              <EmptyTitle>No index history</EmptyTitle>
              <EmptyDescription>
                Build a persistent index to chart record growth.
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
    </DashboardCard>
  );
}
