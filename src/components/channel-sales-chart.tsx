import { useId, useState } from "react";
import { SearchIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

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
  buildSearchActivityRows,
  growthPercent,
} from "@/lib/dashboard-chart-data";
import type { DatasetSummary, LiveSearchActivity } from "@/lib/desktop";

const DEFAULT_VISIBLE_DAYS = 30;

const chartConfig = {
  indexed: { label: "Indexed records", color: "var(--chart-2)" },
  live: { label: "Live matches", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ChannelSalesChart({
  datasets,
  liveSearches,
}: {
  datasets: DatasetSummary[];
  liveSearches: LiveSearchActivity[];
}) {
  const chartUid = useId().replace(/:/g, "");
  const lineGlowId = `search-activity-line-glow-${chartUid}`;
  const [visibleDays, setVisibleDays] =
    useState<HistoryRangeDays>(DEFAULT_VISIBLE_DAYS);
  const rows = buildSearchActivityRows(datasets, liveSearches, visibleDays);
  const hasActivity = rows.some((row) => row.indexed > 0 || row.live > 0);
  const firstTotal = (rows[0]?.indexed ?? 0) + (rows[0]?.live ?? 0);
  const lastTotal = (rows.at(-1)?.indexed ?? 0) + (rows.at(-1)?.live ?? 0);
  const growth = growthPercent(firstTotal, lastTotal);

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Investigation activity</CardTitle>
              {hasActivity ? (
                <Delta value={growth} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue />
                </Delta>
              ) : null}
            </div>
            <CardDescription>
              Indexed completions and Live matches · rolling {visibleDays}-day
              window.
            </CardDescription>
          </div>
          <HistoryRangeToggle onChange={setVisibleDays} value={visibleDays} />
        </div>
      </CardHeader>
      <CardContent>
        {hasActivity ? (
          <ChartContainer
            className="aspect-auto h-60 w-full p-0 md:h-80"
            config={chartConfig}
          >
            <LineChart
              accessibilityLayer
              data={rows}
              margin={{ left: 12, right: 12, top: 8 }}
            >
              <CartesianGrid className="stroke-border" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                tickFormatter={(value) => formatChartAxisTick(String(value))}
                minTickGap={32}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis domain={[0, "auto"]} hide yAxisId="indexed" />
              <YAxis
                domain={[0, "auto"]}
                hide
                orientation="right"
                yAxisId="live"
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(value) =>
                      formatChartTooltipDate(String(value), "long")
                    }
                  />
                }
                cursor={false}
              />
              <defs>
                <filter
                  height="140%"
                  id={lineGlowId}
                  width="140%"
                  x="-20%"
                  y="-20%"
                >
                  <feGaussianBlur result="blur" stdDeviation="10" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <Line
                dataKey="live"
                dot={false}
                filter={`url(#${lineGlowId})`}
                stroke="var(--color-live)"
                strokeWidth={2}
                type="step"
                yAxisId="live"
              />
              <Line
                dataKey="indexed"
                dot={false}
                filter={`url(#${lineGlowId})`}
                stroke="var(--color-indexed)"
                strokeWidth={2}
                type="step"
                yAxisId="indexed"
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <Empty className="h-60 rounded-none border-0 md:h-80">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>No activity in this range</EmptyTitle>
              <EmptyDescription>
                Choose a longer range or run an indexed search or Live scan.
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
