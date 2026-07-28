import { ArrowRight, Database, FolderPlus, ShieldCheck } from "lucide-react";
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
  const recordCount =
    datasets.data?.reduce((sum, dataset) => sum + dataset.recordCount, 0) ?? 0;
  const metrics = [
    {
      label: "Indexed datasets",
      value: (datasets.data?.length ?? 0).toLocaleString(),
    },
    { label: "Searchable records", value: recordCount.toLocaleString() },
    {
      label: "Unique identities",
      value: (identities.data?.length ?? 0).toLocaleString(),
    },
    {
      label: "Parent domains",
      value: new Set(
        domains.data?.map((domain) => domain.registrableDomain) ?? [],
      ).size.toLocaleString(),
    },
    {
      label: "Index storage",
      value: formatBytes(status.data?.indexBytes ?? 0),
    },
  ];
  const hasDatasets = Boolean(datasets.data?.length);

  return (
    <div className="page page--overview">
      <header className="overview-heading">
        <div>
          <p className="font-mono text-[10px] tracking-[0.08em] text-text-tertiary">
            LOCAL INVESTIGATION WORKSPACE
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-text-primary">
            {hasDatasets
              ? "Your local evidence index is ready."
              : "Ready for an authorized dataset."}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            {hasDatasets
              ? `${recordCount.toLocaleString()} records are searchable with source traceability and masked details.`
              : "Add a local source to create a searchable index. Aletheia reads the source without modifying it and keeps every finding traceable."}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => void navigate({ to: "/datasets" })}
        >
          <FolderPlus size={16} aria-hidden="true" />
          Add dataset
        </Button>
      </header>

      <section className="metric-rail" aria-label="Workspace statistics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      <div className="overview-grid">
        <section className="overview-primary">
          <div className="section-heading">
            <div>
              <h2>Recent datasets</h2>
              <p>Indexed and in-progress sources appear here.</p>
            </div>
          </div>
          {datasets.data?.length ? (
            <div className="overview-datasets">
              {datasets.data.slice(0, 5).map((dataset) => (
                <article key={dataset.id}>
                  <Database size={16} />
                  <span>
                    <strong>{dataset.name}</strong>
                    <small>
                      {dataset.fileCount} sources ·{" "}
                      {dataset.recordCount.toLocaleString()} records
                    </small>
                  </span>
                  <em data-status={dataset.status}>{dataset.status}</em>
                </article>
              ))}
            </div>
          ) : (
            <div className="first-dataset">
              <div className="first-dataset__graphic" aria-hidden="true">
                <Database size={30} strokeWidth={1.25} />
              </div>
              <div>
                <h3>No source references</h3>
                <p>
                  Preview a file or folder, confirm its mapping, then create a
                  local index.
                </p>
                <button onClick={() => void navigate({ to: "/datasets" })}>
                  Open datasets
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="privacy-ledger">
          <div className="section-heading">
            <div>
              <h2>Privacy ledger</h2>
              <p>Current workspace protections.</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Network state</dt>
              <dd>
                <ShieldCheck size={14} aria-hidden="true" />
                Offline
              </dd>
            </div>
            <div>
              <dt>Source access</dt>
              <dd>Read-only</dd>
            </div>
            <div>
              <dt>Sensitive values</dt>
              <dd>Masked</dd>
            </div>
            <div>
              <dt>Active jobs</dt>
              <dd className="font-mono">0</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
