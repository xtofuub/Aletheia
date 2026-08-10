import { SearchIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { DatasetSummary, LiveSearchActivity } from "@/lib/desktop";
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
  records: { label: "Indexed records", color: "var(--chart-2)" },
  liveMatches: { label: "Live matches", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ChannelSalesChart({
  datasets,
  liveSearches,
}: {
  datasets: DatasetSummary[];
  liveSearches: LiveSearchActivity[];
}) {
  const rows = [
    ...datasets.map((dataset) => ({
      timestamp: dataset.lastIndexedAt ?? dataset.createdAt,
      records: dataset.recordCount,
      liveMatches: null,
    })),
    ...liveSearches.map((activity) => ({
      timestamp: activity.completedAt,
      records: null,
      liveMatches: activity.matches,
    })),
  ]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-8)
    .map((item) => ({
      label: new Date(item.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      records: item.records,
      liveMatches: item.liveMatches,
    }));
  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader>
        <CardTitle>Search activity</CardTitle>
        <CardDescription>
          Recent index completions and Live scan results.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ChartContainer
            className="aspect-auto h-60 w-full md:h-72"
            config={chartConfig}
          >
            <LineChart
              accessibilityLayer
              data={rows}
              margin={{ left: 12, right: 12, top: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis hide yAxisId="records" />
              <YAxis hide orientation="right" yAxisId="liveMatches" />
              <ChartTooltip
                allowEscapeViewBox={{ x: true, y: true }}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(value) => String(value)}
                  />
                }
                cursor={{ stroke: "var(--border)" }}
                isAnimationActive={false}
                wrapperStyle={{ zIndex: 20 }}
              />
              <Line
                activeDot={{ r: 4 }}
                connectNulls
                dataKey="records"
                dot={{ r: 2 }}
                stroke="var(--color-records)"
                strokeWidth={2}
                type="step"
                yAxisId="records"
              />
              <Line
                activeDot={{ r: 4 }}
                connectNulls
                dataKey="liveMatches"
                dot={{ r: 2 }}
                stroke="var(--color-liveMatches)"
                strokeWidth={2}
                type="step"
                yAxisId="liveMatches"
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <Empty className="h-60 rounded-none border-0 md:h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>No recent searches</EmptyTitle>
              <EmptyDescription>
                Run an indexed search or Live scan to see activity.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                nativeButton={false}
                render={<a href="#/search" />}
                size="sm"
                variant="outline"
              >
                Open Search
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </DashboardCard>
  );
}
