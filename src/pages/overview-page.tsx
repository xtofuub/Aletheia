import {
  ArrowRight,
  BarChart3,
  Database,
  FolderPlus,
  Globe2,
  IdCard,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../components/ui/button";
import {
  getSystemStatus,
  listDatasets,
  listDomains,
  listIdentities,
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

export function OverviewPage() {
  const navigate = useNavigate();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: listIdentities,
  });
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
  });

  const datasetRows = datasets.data ?? [];
  const recordCount = datasetRows.reduce(
    (sum, dataset) => sum + dataset.recordCount,
    0,
  );
  const parentDomainCount = new Set(
    domains.data?.map((domain) => domain.registrableDomain) ?? [],
  ).size;
  const hasDatasets = datasetRows.length > 0;
  const maxDatasetRecords = Math.max(
    1,
    ...datasetRows.map((dataset) => dataset.recordCount),
  );
  const refresh = () =>
    Promise.all([
      datasets.refetch(),
      domains.refetch(),
      identities.refetch(),
      status.refetch(),
    ]);

  return (
    <div className="page page--overview">
      <header className="overview-heading">
        <div>
          <p className="overview-kicker">Local investigation workspace</p>
          <h1>
            {hasDatasets
              ? "Your local evidence index is ready."
              : "Ready for an authorized dataset."}
          </h1>
          <p className="overview-subtitle">
            {hasDatasets
              ? `${recordCount.toLocaleString()} records are searchable with source traceability and masked details.`
              : "Add a local source to create a searchable index. Aletheia reads it without modifying it and keeps every finding traceable."}
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
          <span className="dashboard-notice__icon">
            <ShieldCheck aria-hidden="true" />
          </span>
          <div>
            <strong>
              {hasDatasets ? "Local index ready" : "No dataset indexed"}
            </strong>
            <span>
              {hasDatasets
                ? `${datasetRows.length.toLocaleString()} authorized source ${datasetRows.length === 1 ? "set" : "sets"} available.`
                : "Import remains offline and read-only."}
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

        <div className="dashboard-section-title">
          <div>
            <BarChart3 aria-hidden="true" />
            <span>Index overview</span>
          </div>
          <small>Current local workspace</small>
        </div>

        <div className="overview-chart-grid">
          <div className="records-panel">
            <div className="records-panel__heading">
              <div>
                <span>Searchable records</span>
                <strong>{recordCount.toLocaleString()}</strong>
              </div>
              <span className="records-panel__state">
                {hasDatasets ? "Indexed" : "Waiting for source"}
              </span>
            </div>

            {hasDatasets ? (
              <div
                className="records-chart"
                aria-label="Records indexed by dataset"
              >
                {datasetRows.slice(0, 12).map((dataset) => (
                  <div className="records-chart__column" key={dataset.id}>
                    <span
                      style={{
                        height: `${Math.max(
                          5,
                          (dataset.recordCount / maxDatasetRecords) * 100,
                        )}%`,
                      }}
                      title={`${dataset.name}: ${dataset.recordCount.toLocaleString()} records`}
                    />
                    <small>{dataset.name.slice(0, 2).toUpperCase()}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="records-chart records-chart--empty">
                <Database aria-hidden="true" />
                <span>No records to chart</span>
              </div>
            )}
          </div>

          <div className="overview-stat-grid">
            <div>
              <Database aria-hidden="true" />
              <span>Datasets</span>
              <strong>{datasetRows.length.toLocaleString()}</strong>
              <small>Authorized sources</small>
            </div>
            <div>
              <IdCard aria-hidden="true" />
              <span>Identities</span>
              <strong>{(identities.data?.length ?? 0).toLocaleString()}</strong>
              <small>Grouped locally</small>
            </div>
            <div>
              <Globe2 aria-hidden="true" />
              <span>Parent domains</span>
              <strong>{parentDomainCount.toLocaleString()}</strong>
              <small>Normalized groups</small>
            </div>
            <div>
              <Database aria-hidden="true" />
              <span>Index storage</span>
              <strong>{formatBytes(status.data?.indexBytes ?? 0)}</strong>
              <small>On this device</small>
            </div>
          </div>
        </div>

        <div className="dashboard-dot-divider" aria-hidden="true" />

        <div className="overview-kpi-row">
          <div>
            <span>Network state</span>
            <strong>Offline</strong>
            <small>No data transmitted</small>
          </div>
          <div>
            <span>Source access</span>
            <strong>Read-only</strong>
            <small>Originals unchanged</small>
          </div>
          <div>
            <span>Sensitive values</span>
            <strong>Masked</strong>
            <small>Reveal is deliberate</small>
          </div>
        </div>

        <div className="dashboard-dot-divider" aria-hidden="true" />

        <div className="recent-datasets">
          <div className="dashboard-section-title">
            <div>
              <Database aria-hidden="true" />
              <span>Recent datasets</span>
            </div>
            <button onClick={() => void navigate({ to: "/datasets" })}>
              View all
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
          {hasDatasets ? (
            <div className="recent-datasets__table">
              <div className="recent-datasets__head">
                <span>Dataset</span>
                <span>Records</span>
                <span>Last indexed</span>
                <span>Status</span>
              </div>
              {datasetRows.slice(0, 5).map((dataset) => (
                <button
                  className="recent-datasets__row"
                  key={dataset.id}
                  onClick={() => void navigate({ to: "/datasets" })}
                >
                  <span>
                    <Database aria-hidden="true" />
                    <b>{dataset.name}</b>
                    <small>
                      {dataset.fileCount}{" "}
                      {dataset.fileCount === 1 ? "source" : "sources"}
                    </small>
                  </span>
                  <span>{dataset.recordCount.toLocaleString()}</span>
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
        </div>
      </section>

      <footer className="overview-footer">
        <span>Aletheia v0.1.1</span>
        <span>Local-first investigation</span>
        <span>
          <Search aria-hidden="true" />
          Press / to search
        </span>
      </footer>
    </div>
  );
}
