import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  CalendarDays,
  Database,
  FileStack,
  FolderPlus,
  Globe2,
  HardDrive,
  IdCard,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "../components/ui/button";
import {
  getOverviewStats,
  getSystemStatus,
  listDatasets,
  type DatasetSummary,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";

function formatDate(value: string | null) {
  if (!value) return "Not indexed";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Indexed"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useAnimatedNumber(target: number, duration = 520) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? target : 0);
  const current = useRef(reducedMotion ? target : 0);

  useEffect(() => {
    if (reducedMotion) {
      current.current = target;
      return;
    }

    const from = current.current;
    const difference = target - from;
    if (difference === 0) return;

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + difference * eased);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reducedMotion, target]);

  return reducedMotion ? target : display;
}

function AnimatedNumber({ value }: { value: number }) {
  return <>{useAnimatedNumber(value).toLocaleString()}</>;
}

function buildChartData(datasets: DatasetSummary[]) {
  const ordered = [...datasets].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  let cumulative = 0;
  const points = ordered.map((dataset, index) => {
    cumulative += dataset.recordCount;
    const date = new Date(dataset.lastIndexedAt ?? dataset.createdAt);
    return {
      label: Number.isNaN(date.getTime())
        ? `Source ${index + 1}`
        : new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
          }).format(date),
      dataset: dataset.name,
      indexed: cumulative,
      sourceRecords: dataset.recordCount,
    };
  });

  if (points.length === 0) {
    return [
      { label: "Start", dataset: "No dataset", indexed: 0, sourceRecords: 0 },
      { label: "Now", dataset: "No dataset", indexed: 0, sourceRecords: 0 },
    ];
  }

  const visiblePoints = points.slice(-9);
  const firstVisiblePoint = visiblePoints[0]!;
  const baseline = firstVisiblePoint.indexed - firstVisiblePoint.sourceRecords;
  return [
    {
      label: "Start",
      dataset: "Baseline",
      indexed: baseline,
      sourceRecords: 0,
    },
    ...visiblePoints,
  ];
}

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    value?: number;
    payload?: { dataset?: string };
  }>;
  label?: string;
};

function IndexChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const dataset = payload[0]?.payload?.dataset;
  return (
    <div className="index-chart-tooltip">
      <strong>{dataset === "Baseline" ? label : dataset}</strong>
      {payload.map((item) => (
        <div key={String(item.dataKey)}>
          <span style={{ background: item.color }} />
          <small>
            {item.dataKey === "indexed"
              ? "Cumulative records"
              : "Source records"}
          </small>
          <b>{(item.value ?? 0).toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const overviewStats = useQuery({
    queryKey: ["overview-stats"],
    queryFn: getOverviewStats,
  });
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
  });

  const datasetRows = useMemo(() => datasets.data ?? [], [datasets.data]);
  const recordCount = datasetRows.reduce(
    (sum, dataset) => sum + dataset.recordCount,
    0,
  );
  const warningCount = datasetRows.reduce(
    (sum, dataset) => sum + dataset.warningCount,
    0,
  );
  const sourceCount = datasetRows.reduce(
    (sum, dataset) => sum + dataset.fileCount,
    0,
  );
  const parentDomainCount = overviewStats.data?.parentDomainCount ?? 0;
  const hasDatasets = datasetRows.length > 0;
  const readyCount = datasetRows.filter(
    (dataset) => dataset.status === "ready",
  ).length;
  const chartData = useMemo(() => buildChartData(datasetRows), [datasetRows]);
  const refresh = () =>
    Promise.all([
      datasets.refetch(),
      overviewStats.refetch(),
      status.refetch(),
    ]);

  return (
    <div className="page page--overview">
      <header className="overview-heading">
        <div>
          <div className="overview-greeting">
            <Sparkles aria-hidden="true" />
            <span>Private workspace</span>
          </div>
          <h1>
            {hasDatasets
              ? "Your local evidence index is ready."
              : "Ready for an authorized dataset."}
          </h1>
          <p className="overview-subtitle">
            {hasDatasets
              ? `${recordCount.toLocaleString()} records are searchable, traceable, and stored only on this device.`
              : "Add a local source to create a searchable index. Aletheia reads it without modifying it."}
          </p>
        </div>
        <div className="overview-heading__actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            aria-label="Refresh dashboard"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void navigate({ to: "/datasets" })}
          >
            <FolderPlus aria-hidden="true" />
            Add dataset
          </Button>
        </div>
      </header>

      <section
        className="dashboard-grid-shell"
        aria-label="Workspace statistics"
      >
        <div className="dashboard-notice">
          <span
            className="dashboard-notice__signal"
            data-ready={hasDatasets}
            aria-hidden="true"
          >
            <i />
          </span>
          <div>
            <strong>
              {hasDatasets ? "Local index is current" : "Waiting for a source"}
            </strong>
            <span>
              {hasDatasets
                ? `${readyCount} of ${datasetRows.length} datasets ready · ${formatBytes(status.data?.indexBytes ?? 0)} index storage`
                : "Import remains offline, read-only, and under your control."}
            </span>
          </div>
          <button
            onClick={() =>
              void navigate({ to: hasDatasets ? "/search" : "/datasets" })
            }
          >
            {hasDatasets ? "Search records" : "Open datasets"}
            <ArrowRight aria-hidden="true" />
          </button>
        </div>

        <div className="dashboard-dot-divider" aria-hidden="true" />

        <div className="overview-chart-grid">
          <article className="dashboard-card records-panel">
            <header className="dashboard-card__header">
              <div>
                <TrendingUp aria-hidden="true" />
                <span>Index growth</span>
              </div>
              <span className="dashboard-card__scope">
                <CalendarDays aria-hidden="true" />
                All datasets
              </span>
            </header>
            <div className="records-panel__body">
              <div className="records-panel__heading">
                <div>
                  <span>Searchable records</span>
                  <strong>
                    <AnimatedNumber value={recordCount} />
                  </strong>
                </div>
                <div className="records-panel__legend">
                  <span>
                    <i data-line="solid" />
                    Cumulative
                  </span>
                  <span>
                    <i data-line="dashed" />
                    Per source
                  </span>
                </div>
              </div>

              <div
                className="index-growth-chart"
                aria-label="Cumulative and per-source indexed records"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 10, bottom: 0, left: -13 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--border)"
                      strokeDasharray="4 4"
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tickMargin={10}
                      minTickGap={18}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickMargin={4}
                      width={50}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 10,
                      }}
                      tickFormatter={compactNumber}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "var(--border-strong)",
                        strokeDasharray: "4 4",
                      }}
                      content={<IndexChartTooltip />}
                    />
                    <Line
                      dataKey="indexed"
                      type="linear"
                      stroke="var(--foreground)"
                      strokeWidth={1.7}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      isAnimationActive={!reducedMotion}
                      animationDuration={700}
                      animationEasing="ease-out"
                    />
                    <Line
                      dataKey="sourceRecords"
                      type="linear"
                      stroke="var(--muted-foreground)"
                      strokeWidth={1.4}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      isAnimationActive={!reducedMotion}
                      animationBegin={120}
                      animationDuration={700}
                      animationEasing="ease-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
                {!hasDatasets ? (
                  <div className="index-growth-chart__empty">
                    <Database aria-hidden="true" />
                    Add a source to begin the timeline
                  </div>
                ) : null}
              </div>
            </div>
          </article>

          <article className="dashboard-card assets-panel">
            <header className="dashboard-card__header">
              <div>
                <HardDrive aria-hidden="true" />
                <span>Workspace assets</span>
              </div>
            </header>
            <div className="overview-stat-grid">
              <div>
                <span className="asset-icon">
                  <Database aria-hidden="true" />
                </span>
                <strong>
                  <AnimatedNumber value={datasetRows.length} />
                </strong>
                <small>Datasets</small>
              </div>
              <div>
                <span className="asset-icon">
                  <IdCard aria-hidden="true" />
                </span>
                <strong>
                  <AnimatedNumber
                    value={overviewStats.data?.identityGroupCount ?? 0}
                  />
                </strong>
                <small>Identity groups</small>
              </div>
              <div>
                <span className="asset-icon">
                  <Globe2 aria-hidden="true" />
                </span>
                <strong>
                  <AnimatedNumber value={parentDomainCount} />
                </strong>
                <small>Parent domains</small>
              </div>
              <div>
                <span className="asset-icon">
                  <HardDrive aria-hidden="true" />
                </span>
                <strong>{formatBytes(status.data?.indexBytes ?? 0)}</strong>
                <small>Local index</small>
              </div>
            </div>
          </article>
        </div>

        <div className="dashboard-dot-divider" aria-hidden="true" />

        <div className="overview-kpi-row">
          <article>
            <div>
              <span>Indexed sources</span>
              <strong>
                <AnimatedNumber value={sourceCount} />
              </strong>
              <small>{readyCount} datasets ready</small>
            </div>
            <span className="kpi-icon">
              <FileStack aria-hidden="true" />
            </span>
            <button onClick={() => void navigate({ to: "/datasets" })}>
              View datasets
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
          <article>
            <div>
              <span>Import warnings</span>
              <strong>
                <AnimatedNumber value={warningCount} />
              </strong>
              <small>
                {warningCount === 0 ? "No review needed" : "Review recommended"}
              </small>
            </div>
            <span className="kpi-icon">
              <TriangleAlert aria-hidden="true" />
            </span>
            <button onClick={() => void navigate({ to: "/datasets" })}>
              Review jobs
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
          <article>
            <div>
              <span>Privacy posture</span>
              <strong>Offline</strong>
              <small>No data transmitted</small>
            </div>
            <span className="kpi-icon kpi-icon--safe">
              <ShieldCheck aria-hidden="true" />
            </span>
            <button onClick={() => void navigate({ to: "/settings" })}>
              View controls
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
        </div>

        <div className="dashboard-dot-divider" aria-hidden="true" />

        <article className="recent-datasets dashboard-card">
          <header className="dashboard-card__header">
            <div>
              <Database aria-hidden="true" />
              <span>Recent datasets</span>
            </div>
            <button onClick={() => void navigate({ to: "/datasets" })}>
              View all
              <ArrowRight aria-hidden="true" />
            </button>
          </header>
          {hasDatasets ? (
            <div className="recent-datasets__table">
              <div className="recent-datasets__head">
                <span>
                  Dataset <ArrowDownUp aria-hidden="true" />
                </span>
                <span>Sources</span>
                <span>Records</span>
                <span>Warnings</span>
                <span>Last indexed</span>
                <span>Status</span>
              </div>
              {datasetRows.slice(0, 6).map((dataset) => (
                <button
                  className="recent-datasets__row"
                  key={dataset.id}
                  onClick={() => void navigate({ to: "/datasets" })}
                >
                  <span>
                    <i>
                      <Database aria-hidden="true" />
                    </i>
                    <b>{dataset.name}</b>
                    <small>{formatBytes(dataset.totalBytes)}</small>
                  </span>
                  <span>{dataset.fileCount.toLocaleString()}</span>
                  <span>{dataset.recordCount.toLocaleString()}</span>
                  <span>{dataset.warningCount.toLocaleString()}</span>
                  <span>{formatDate(dataset.lastIndexedAt)}</span>
                  <span data-status={dataset.status}>{dataset.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="recent-datasets__empty">
              <span className="recent-datasets__empty-icon">
                <Database aria-hidden="true" />
              </span>
              <div>
                <strong>No source references</strong>
                <p>
                  Preview a file or folder, confirm its mapping, then create a
                  local index.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate({ to: "/datasets" })}
              >
                Open datasets
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </article>
      </section>

      <footer className="overview-footer">
        <span>Aletheia v0.1.4</span>
        <span>Local-first investigation</span>
        <span>
          <Search aria-hidden="true" />
          Press / to search
        </span>
      </footer>
    </div>
  );
}
