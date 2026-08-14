import type * as React from "react";
import { DatabaseIcon } from "lucide-react";
import { Bar, BarChart, XAxis } from "recharts";

import { DashboardCard } from "@/components/dashboard-card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { formatChartAxisTick } from "@/components/formater";
import { Button } from "@/components/ui/button";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  buildIndexGrowthRows,
  growthPercent,
} from "@/lib/dashboard-chart-data";
import type { DatasetSummary } from "@/lib/desktop";
import { formatCount } from "@/lib/format";

const VISIBLE_DAYS = 7;

const chartConfig = {
  records: { label: "Indexed records", color: "var(--chart-2)" },
} satisfies ChartConfig;

function CustomGradientBar(
  props: React.SVGProps<SVGRectElement> & {
    index?: number;
    dataKey?: string | number;
  },
) {
  const {
    fill,
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    dataKey = "records",
    index = 0,
  } = props;
  const gradientId = `index-growth-${String(dataKey)}-${index}`;

  return (
    <>
      <rect
        fill={`url(#${gradientId})`}
        height={height}
        stroke="none"
        width={width}
        x={x}
        y={y}
      />
      <rect fill={fill} height={2} stroke="none" width={width} x={x} y={y} />
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={0.5} />
          <stop offset="100%" stopColor={fill} stopOpacity={0} />
        </linearGradient>
      </defs>
    </>
  );
}

export function NetRevenueChart({ datasets }: { datasets: DatasetSummary[] }) {
  const rows = buildIndexGrowthRows(datasets, VISIBLE_DAYS);
  const total = datasets.reduce((sum, dataset) => sum + dataset.recordCount, 0);
  const growth = growthPercent(
    rows[0]?.records ?? 0,
    rows.at(-1)?.records ?? 0,
  );

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Index growth</CardTitle>
          {rows.length ? (
            <Delta value={growth} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue />
            </Delta>
          ) : null}
        </div>
        <CardDescription>
          {formatCount(total)} cumulative records across the latest seven days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ChartContainer
            className="aspect-auto h-60 w-full md:h-80"
            config={chartConfig}
          >
            <BarChart accessibilityLayer data={rows}>
              <XAxis
                axisLine={false}
                dataKey="date"
                interval={0}
                tickFormatter={(value) =>
                  formatChartAxisTick(String(value), VISIBLE_DAYS)
                }
                tickLine={false}
                tickMargin={10}
              />
              <ChartTooltip
                content={<ChartTooltipContent hideLabel />}
                cursor={false}
              />
              <Bar
                dataKey="records"
                fill="var(--color-records)"
                shape={<CustomGradientBar />}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty className="h-60 rounded-none border-0 md:h-80">
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
