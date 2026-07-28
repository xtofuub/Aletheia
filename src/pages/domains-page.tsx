import { type FormEvent, useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
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
import { PaginationControls } from "../components/ui/pagination-controls";
import {
  getDomainDetails,
  listDomains,
  type DomainGroupSummary,
} from "../lib/desktop";

export function DomainsPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<DomainGroupSummary | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [hostnameDraft, setHostnameDraft] = useState("");
  const deferredHostnameDraft = useDeferredValue(hostnameDraft);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [recordOffset, setRecordOffset] = useState(0);
  const [recordPageSize, setRecordPageSize] = useState(25);
  const domains = useQuery({
    queryKey: ["domains", query, offset, pageSize],
    queryFn: () => listDomains(query, offset, pageSize),
    placeholderData: keepPreviousData,
  });
  const details = useQuery({
    queryKey: [
      "domain-details",
      selected?.registrableDomain,
      hostname,
      deferredHostnameDraft,
      datasetId,
      recordOffset,
      recordPageSize,
    ],
    queryFn: () =>
      getDomainDetails(
        selected?.registrableDomain ?? "",
        hostname,
        deferredHostnameDraft || null,
        datasetId,
        recordOffset,
        recordPageSize,
      ),
    enabled: Boolean(selected),
    staleTime: 30_000,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSelected(null);
    setHostname(null);
    setHostnameDraft("");
    setDatasetId(null);
    setRecordOffset(0);
    setQuery(draft.trim());
  }

  function openDomain(group: DomainGroupSummary) {
    setSelected(group);
    setHostname(null);
    setHostnameDraft("");
    setDatasetId(null);
    setRecordOffset(0);
  }

  function filterDataset(nextDatasetId: string | null) {
    setDatasetId(nextDatasetId);
    setRecordOffset(0);
  }

  function filterHostname(nextHostname: string | null) {
    setHostname(nextHostname);
    setDatasetId(null);
    setRecordOffset(0);
  }

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
            <footer>
              <PaginationControls
                label="domains"
                offset={offset}
                total={domains.data.total}
                pageSize={pageSize}
                busy={domains.isFetching}
                onOffsetChange={setOffset}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setOffset(0);
                }}
                pageSizes={[25, 50, 100]}
              />
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
                      <small>
                        {details.data.hostnames.length.toLocaleString()} of{" "}
                        {selected.hostnameCount.toLocaleString()}
                      </small>
                    </h3>
                    <label className="domain-host-search">
                      <Search size={13} />
                      <input
                        aria-label="Filter observed hostnames"
                        placeholder="Filter hostnames"
                        value={hostnameDraft}
                        onChange={(event) =>
                          setHostnameDraft(event.target.value.toLowerCase())
                        }
                      />
                    </label>
                    <div className="domain-hostnames">
                      <button
                        data-active={!hostname}
                        onClick={() => filterHostname(null)}
                      >
                        <code>All hostnames</code>
                        <small>{selected.recordCount.toLocaleString()}</small>
                      </button>
                      {details.data.hostnames.map((item) => (
                        <button
                          data-active={hostname === item.hostname}
                          key={item.id}
                          onClick={() => filterHostname(item.hostname)}
                        >
                          <code>{item.hostname}</code>
                          <small>{item.recordCount.toLocaleString()}</small>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="domain-detail__section">
                    <h3>
                      <Database size={14} />
                      Linked breach datasets
                      <small>
                        {details.data.breaches.length.toLocaleString()} datasets
                      </small>
                    </h3>
                    <div className="domain-breaches">
                      <button
                        data-active={!datasetId}
                        onClick={() => filterDataset(null)}
                      >
                        <span>All datasets</span>
                        <strong>
                          {details.data.totalRecords.toLocaleString()}
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
                                {field.displayValue || "Not available"}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </article>
                    ))}
                    <footer>
                      <PaginationControls
                        label="domain records"
                        offset={recordOffset}
                        total={details.data.totalRecords}
                        pageSize={recordPageSize}
                        busy={details.isFetching}
                        onOffsetChange={setRecordOffset}
                        onPageSizeChange={(size) => {
                          setRecordPageSize(size);
                          setRecordOffset(0);
                        }}
                        pageSizes={[10, 25, 50, 100]}
                      />
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
