import { useId } from "react";
import { SearchIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { DashboardCard } from "@/components/dashboard-card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
  formatChartAxisTick,
  formatChartTooltipDate,
} from "@/components/formater";
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

const VISIBLE_DAYS = 7;

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
  const rows = buildSearchActivityRows(datasets, liveSearches, VISIBLE_DAYS);
  const firstTotal = (rows[0]?.indexed ?? 0) + (rows[0]?.live ?? 0);
  const lastTotal = (rows.at(-1)?.indexed ?? 0) + (rows.at(-1)?.live ?? 0);
  const growth = growthPercent(firstTotal, lastTotal);

  return (
    <DashboardCard className="gap-0 md:col-span-2">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Search activity</CardTitle>
          {rows.length ? (
            <Delta value={growth} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue />
            </Delta>
          ) : null}
        </div>
        <CardDescription>
          Daily index completions and Live matches, latest seven days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
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
                interval={0}
                tickFormatter={(value) =>
                  formatChartAxisTick(String(value), VISIBLE_DAYS)
                }
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
              <EmptyTitle>No recent activity</EmptyTitle>
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
