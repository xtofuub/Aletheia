import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import type { DatasetSummary, LiveSearchActivity } from "@/lib/desktop";
import { DashboardCard } from "@/components/dashboard-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      liveMatches: 0,
    })),
    ...liveSearches.map((activity) => ({
      timestamp: activity.completedAt,
      records: 0,
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
  const chartRows = rows.length
    ? rows
    : [{ label: "Now", records: 0, liveMatches: 0 }];

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader>
        <CardTitle>Search activity</CardTitle>
        <CardDescription>
          Indexed records and Live matches from recent jobs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          className="aspect-auto h-60 w-full md:h-72"
          config={chartConfig}
        >
          <LineChart
            accessibilityLayer
            data={chartRows}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tickLine={false}
              tickMargin={8}
            />
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
              dataKey="records"
              dot={{ r: 2 }}
              stroke="var(--color-records)"
              strokeWidth={2}
              type="step"
            />
            <Line
              activeDot={{ r: 4 }}
              dataKey="liveMatches"
              dot={{ r: 2 }}
              stroke="var(--color-liveMatches)"
              strokeWidth={2}
              type="step"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </DashboardCard>
  );
}
