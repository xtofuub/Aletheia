import { useState, type SVGProps } from "react";
import { DatabaseIcon } from "lucide-react";
import { Bar, BarChart, XAxis } from "recharts";

import { DashboardCard } from "@/components/dashboard-card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
  formatChartAxisTick,
  formatChartTooltipDate,
} from "@/components/formater";
import {
  HistoryRangeToggle,
  type HistoryRangeDays,
} from "@/components/history-range-toggle";
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

const DEFAULT_VISIBLE_DAYS = 30;

const chartConfig = {
  records: { label: "Indexed records", color: "var(--chart-2)" },
} satisfies ChartConfig;

function CustomGradientBar(
  props: SVGProps<SVGRectElement> & {
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
  const [visibleDays, setVisibleDays] =
    useState<HistoryRangeDays>(DEFAULT_VISIBLE_DAYS);
  const rows = buildIndexGrowthRows(datasets, visibleDays);
  const total = datasets.reduce((sum, dataset) => sum + dataset.recordCount, 0);
  const growth = growthPercent(
    rows[0]?.records ?? 0,
    rows.at(-1)?.records ?? 0,
  );

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Indexed footprint</CardTitle>
              {rows.length ? (
                <Delta value={growth} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue />
                </Delta>
              ) : null}
            </div>
            <CardDescription>
              {formatCount(total)} cumulative records · rolling {visibleDays}
              -day window.
            </CardDescription>
          </div>
          <HistoryRangeToggle onChange={setVisibleDays} value={visibleDays} />
        </div>
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
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartAxisTick(String(value))}
                minTickGap={32}
                tickLine={false}
                tickMargin={10}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      formatChartTooltipDate(String(value), "long")
                    }
                  />
                }
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
