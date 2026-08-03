import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import type { DatasetSummary } from "@/lib/desktop";
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
  records: { label: "Records", color: "var(--chart-2)" },
  files: { label: "Files", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ChannelSalesChart({
  datasets,
}: {
  datasets: DatasetSummary[];
}) {
  const rows = datasets
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-8)
    .map((dataset) => ({
      label: new Date(dataset.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      records: dataset.recordCount,
      files: dataset.fileCount,
    }));
  const chartRows = rows.length
    ? rows
    : [{ label: "Now", records: 0, files: 0 }];

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader>
        <CardTitle>Import activity</CardTitle>
        <CardDescription>
          Records and source files by recent dataset.
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
              dataKey="files"
              dot={{ r: 2 }}
              stroke="var(--color-files)"
              strokeWidth={2}
              type="step"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </DashboardCard>
  );
}
