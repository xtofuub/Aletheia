import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  Globe2,
  LoaderCircle,
  Network,
  Search,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import {
  getDomainDetails,
  listDomains,
  type DomainGroupSummary,
} from "../lib/desktop";

const pageSize = 50;

export function DomainsPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<DomainGroupSummary | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [recordOffset, setRecordOffset] = useState(0);
  const domains = useQuery({
    queryKey: ["domains", query, offset],
    queryFn: () => listDomains(query, offset, pageSize),
  });
  const details = useQuery({
    queryKey: [
      "domain-details",
      selected?.registrableDomain,
      datasetId,
      recordOffset,
    ],
    queryFn: () =>
      getDomainDetails(
        selected?.registrableDomain ?? "",
        datasetId,
        recordOffset,
        pageSize,
      ),
    enabled: Boolean(selected),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSelected(null);
    setDatasetId(null);
    setRecordOffset(0);
    setQuery(draft.trim());
  }

  function openDomain(group: DomainGroupSummary) {
    setSelected(group);
    setDatasetId(null);
    setRecordOffset(0);
  }

  function filterDataset(nextDatasetId: string | null) {
    setDatasetId(nextDatasetId);
    setRecordOffset(0);
  }

  const domainHasNext =
    (domains.data?.offset ?? 0) + (domains.data?.groups.length ?? 0) <
    (domains.data?.total ?? 0);
  const recordsHaveNext =
    (details.data?.recordOffset ?? 0) + (details.data?.records.length ?? 0) <
    (details.data?.totalRecords ?? 0);

  return (
    <div className="page">
      <PageHeader
        title="Domains"
        description="Find a domain, then inspect every linked dataset and source record."
        meta={`${(domains.data?.total ?? 0).toLocaleString()} PARENTS`}
      />

      <form className="domain-search" onSubmit={submit}>
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="Search domains"
          placeholder="Search a parent domain or hostname"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={253}
        />
        <Button size="sm" variant="primary" type="submit">
          Search
        </Button>
      </form>

      {domains.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Searching local domain index
        </div>
      ) : domains.data?.groups.length ? (
        <div className="domain-workspace" data-detail={Boolean(selected)}>
          <section className="domain-explorer">
            <header className="domain-explorer__head">
              <span>Registrable domain</span>
              <span>Hosts</span>
              <span>Records</span>
            </header>
            {domains.data.groups.map((group) => (
              <button
                className="domain-row"
                data-active={
                  selected?.registrableDomain === group.registrableDomain
                }
                key={group.registrableDomain}
                onClick={() => openDomain(group)}
              >
                <span className="domain-row__name">
                  <Globe2 size={15} />
                  <span>
                    <strong>{group.registrableDomain}</strong>
                    <small>{group.publicSuffix ?? "private suffix"}</small>
                  </span>
                </span>
                <span className="font-mono">
                  {group.hostnameCount.toLocaleString()}
                </span>
                <span className="font-mono">
                  {group.recordCount.toLocaleString()}
                </span>
              </button>
            ))}
            <footer className="result-pagination">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                <ChevronLeft size={14} />
                Previous
              </Button>
              <span className="font-mono">
                {offset + 1}–
                {Math.min(
                  offset + domains.data.groups.length,
                  domains.data.total,
                ).toLocaleString()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!domainHasNext}
                onClick={() => setOffset(offset + pageSize)}
              >
                Next
                <ChevronRight size={14} />
              </Button>
            </footer>
          </section>

          {selected ? (
            <aside className="domain-detail">
              <header className="domain-detail__header">
                <div>
                  <span className="eyebrow">DOMAIN EVIDENCE</span>
                  <h2>{selected.registrableDomain}</h2>
                </div>
                <Globe2 size={18} />
              </header>
              {details.isLoading ? (
                <div className="loading-line">
                  <LoaderCircle className="animate-spin" size={15} />
                  Loading linked evidence
                </div>
              ) : details.data ? (
                <>
                  <section className="domain-detail__section">
                    <h3>
                      <Network size={14} />
                      Observed hostnames
                    </h3>
                    <div className="domain-hostnames">
                      {details.data.hostnames.map((hostname) => (
                        <span key={hostname.id}>
                          <code>{hostname.hostname}</code>
                          <small>{hostname.recordCount.toLocaleString()}</small>
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="domain-detail__section">
                    <h3>
                      <Database size={14} />
                      Linked breach datasets
                    </h3>
                    <div className="domain-breaches">
                      <button
                        data-active={!datasetId}
                        onClick={() => filterDataset(null)}
                      >
                        <span>All datasets</span>
                        <strong>
                          {details.data.breaches.length.toLocaleString()}
                        </strong>
                      </button>
                      {details.data.breaches.map((breach) => (
                        <button
                          data-active={datasetId === breach.datasetId}
                          key={breach.datasetId}
                          onClick={() => filterDataset(breach.datasetId)}
                        >
                          <span>{breach.datasetName}</span>
                          <strong>{breach.recordCount.toLocaleString()}</strong>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="domain-detail__section domain-records">
                    <h3>
                      <FileSearch size={14} />
                      Masked line contents
                      <small>
                        {details.data.totalRecords.toLocaleString()}
                      </small>
                    </h3>
                    {details.data.records.map((record) => (
                      <article key={record.recordId}>
                        <header>
                          <span>
                            <strong>{record.datasetName}</strong>
                            <small>{record.sourceFile}</small>
                          </span>
                          <span className="source-location">
                            {record.sourceLocation}
                            <small>{record.parser}</small>
                          </span>
                        </header>
                        <dl>
                          {record.fields.map((field) => (
                            <div key={`${record.recordId}-${field.name}`}>
                              <dt>{field.name}</dt>
                              <dd
                                className="font-mono"
                                data-sensitive={field.sensitive}
                              >
                                {field.displayValue || "—"}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </article>
                    ))}
                    <footer className="result-pagination">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={recordOffset === 0}
                        onClick={() =>
                          setRecordOffset(Math.max(0, recordOffset - pageSize))
                        }
                      >
                        <ChevronLeft size={14} />
                        Previous
                      </Button>
                      <span className="font-mono">
                        {details.data.totalRecords
                          ? details.data.recordOffset + 1
                          : 0}
                        –
                        {Math.min(
                          details.data.recordOffset +
                            details.data.records.length,
                          details.data.totalRecords,
                        ).toLocaleString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!recordsHaveNext}
                        onClick={() => setRecordOffset(recordOffset + pageSize)}
                      >
                        Next
                        <ChevronRight size={14} />
                      </Button>
                    </footer>
                  </section>
                </>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={Globe2}
          title={query ? "No matching domains" : "No normalized domains"}
          description="Domains extracted during import appear here and stay connected to their datasets and source records."
          detail="Search is local and prefix-indexed for large workspaces."
        />
      )}
    </div>
  );
}
