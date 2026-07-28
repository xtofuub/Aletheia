import { useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Download,
  FileSearch,
  LoaderCircle,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { PaginationControls } from "../components/ui/pagination-controls";
import {
  exportRecords,
  listDatasets,
  saveSearch,
  searchRecords,
  selectExportDestination,
  type SearchHit,
  type ExportFormat,
  type FieldType,
  type SearchMode,
} from "../lib/desktop";

const modes: Array<{ value: SearchMode; label: string }> = [
  { value: "exact", label: "Exact" },
  { value: "contains", label: "Contains" },
  { value: "prefix", label: "Prefix" },
];

export function SearchPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("contains");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState<FieldType | null>(null);
  const [sort, setSort] = useState<"relevance" | "source" | "dataset">(
    "relevance",
  );
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SearchHit | null>(null);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [notice, setNotice] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const results = useQuery({
    queryKey: ["search", query, mode, datasetId, fieldType, offset, pageSize],
    queryFn: () =>
      searchRecords({
        query,
        mode,
        datasetId,
        fieldType,
        offset,
        limit: pageSize,
      }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
  const displayedHits = useMemo(() => {
    const hits = [...(results.data?.hits ?? [])];
    if (sort === "source") {
      hits.sort((left, right) =>
        `${left.sourceFile}\u{1f}${left.sourceLocation}`.localeCompare(
          `${right.sourceFile}\u{1f}${right.sourceLocation}`,
        ),
      );
    } else if (sort === "dataset") {
      hits.sort((left, right) =>
        left.datasetName.localeCompare(right.datasetName),
      );
    }
    return hits;
  }, [results.data?.hits, sort]);
  const scrollRef = useRef<HTMLDivElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setOffset(0);
    setSelected(new Set());
    setDetail(null);
    setQuery(next);
  }

  function toggleSelection(recordId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  async function createSavedSearch() {
    if (!saveName.trim() || !query) return;
    await saveSearch(
      saveName.trim(),
      query,
      JSON.stringify({ mode, datasetId, fieldType, sort }),
    );
    setShowSave(false);
    setSaveName("");
    setNotice("Search saved locally");
  }

  async function exportSelection() {
    if (!selected.size) return;
    const destinationPath = await selectExportDestination(exportFormat);
    if (!destinationPath) return;
    const exported = await exportRecords({
      destinationPath,
      format: exportFormat,
      recordIds: [...selected],
      maskEmailLocalPart: true,
    });
    setNotice(
      `${exported.recordCount.toLocaleString()} redacted record${exported.recordCount === 1 ? "" : "s"} exported`,
    );
  }

  function movePage(nextOffset: number) {
    setOffset(Math.max(0, nextOffset));
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className="page page--search">
      <PageHeader
        title="Search"
        description="Query normalized identifiers and keep every match tied to its local source."
        meta="LOCAL INDEX"
        action={
          query ? (
            <div className="search-actions">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSave((value) => !value)}
              >
                <BookmarkPlus size={14} />
                Save view
              </Button>
              <select
                aria-label="Export format"
                value={exportFormat}
                onChange={(event) =>
                  setExportFormat(event.target.value as ExportFormat)
                }
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSONL</option>
                <option value="markdown">Markdown</option>
              </select>
              <Button
                size="sm"
                variant="primary"
                disabled={!selected.size}
                onClick={() => void exportSelection()}
              >
                <Download size={14} />
                Export {selected.size || ""}
              </Button>
            </div>
          ) : undefined
        }
      />
      <form className="search-composer" onSubmit={submit}>
        <Search size={19} strokeWidth={1.6} aria-hidden="true" />
        <input
          aria-label="Search local index"
          placeholder="Search email, domain, username, phone, IP, or URL"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={512}
        />
        <kbd>Enter</kbd>
      </form>

      <details className="search-advanced">
        <summary>
          Search options
          <span>
            {modes.find((item) => item.value === mode)?.label} ·{" "}
            {datasetId ? "1 dataset" : "All datasets"} ·{" "}
            {fieldType ?? "Any field"}
          </span>
        </summary>
        <div className="search-controls">
          <div className="segmented-control segmented-control--compact">
            {modes.map((item) => (
              <button
                type="button"
                key={item.value}
                data-active={mode === item.value}
                onClick={() => {
                  setMode(item.value);
                  setOffset(0);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label>
            <span>Dataset</span>
            <select
              aria-label="Dataset"
              value={datasetId ?? ""}
              onChange={(event) => {
                setDatasetId(event.target.value || null);
                setOffset(0);
              }}
            >
              <option value="">All local datasets</option>
              {datasets.data?.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Field</span>
            <select
              aria-label="Field"
              value={fieldType ?? ""}
              onChange={(event) => {
                setFieldType((event.target.value || null) as FieldType | null);
                setOffset(0);
              }}
            >
              <option value="">Any field</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="domain">Domain</option>
              <option value="url">URL</option>
              <option value="ip_address">IP address</option>
              <option value="username">Username</option>
              <option value="user_id">Service user ID</option>
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select
              aria-label="Sort"
              value={sort}
              onChange={(event) =>
                setSort(
                  event.target.value as "relevance" | "source" | "dataset",
                )
              }
            >
              <option value="relevance">Relevance</option>
              <option value="source">Source location</option>
              <option value="dataset">Dataset</option>
            </select>
          </label>
          <span className="privacy-inline">
            <LockKeyhole size={13} />
            Secrets excluded
          </span>
        </div>
      </details>

      {showSave ? (
        <div className="inline-save">
          <input
            aria-label="Saved view name"
            placeholder="Investigation view name"
            value={saveName}
            maxLength={120}
            onChange={(event) => setSaveName(event.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!saveName.trim()}
            onClick={() => void createSavedSearch()}
          >
            Save locally
          </Button>
        </div>
      ) : null}

      {notice ? <p className="notice-line">{notice}</p> : null}

      {!query ? (
        <EmptyState
          icon={Search}
          title="Search the local evidence index"
          description="Type any email, domain, username, phone, IP address, or URL. Results stay masked until deliberately exported."
          detail="Secret fields are never added to the general Tantivy index."
        />
      ) : results.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Searching the local index
        </div>
      ) : results.isError ? (
        <EmptyState
          icon={Search}
          title="Search could not complete"
          description={String(results.error)}
          detail="The local index was not changed."
          action={
            <Button variant="primary" onClick={() => void results.refetch()}>
              Try again
            </Button>
          }
        />
      ) : results.data?.hits.length ? (
        <div className="result-workspace" data-detail={Boolean(detail)}>
          <section className="result-list">
            <header className="result-list__head">
              <span>{results.data.total.toLocaleString()} matches</span>
              <span>
                {results.isFetching ? "Updating page" : "Masked locally"}
              </span>
            </header>
            <div className="result-scroll" ref={scrollRef}>
              <div className="result-table">
                {displayedHits.map((hit) => {
                  const primary = hit.fields.find(
                    (field) => field.fieldType !== "password",
                  );
                  return (
                    <article
                      className="result-row"
                      data-active={detail?.recordId === hit.recordId}
                      key={hit.recordId}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${hit.recordId}`}
                        checked={selected.has(hit.recordId)}
                        onChange={() => toggleSelection(hit.recordId)}
                      />
                      <button onClick={() => setDetail(hit)}>
                        <span className="result-row__main">
                          <strong>
                            {primary?.displayValue ?? "Masked record"}
                          </strong>
                          <small>
                            {hit.datasetName} · {hit.sourceFile}
                          </small>
                        </span>
                        <span className="source-location">
                          {hit.sourceLocation}
                        </span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
            <footer>
              <PaginationControls
                label="search results"
                offset={offset}
                total={results.data.total}
                pageSize={pageSize}
                busy={results.isFetching}
                onOffsetChange={movePage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  movePage(0);
                }}
              />
            </footer>
          </section>
          {detail ? (
            <aside className="record-detail">
              <header>
                <div>
                  <span className="eyebrow">RECORD DETAIL</span>
                  <h2>Masked fields</h2>
                </div>
                <ShieldCheck size={18} />
              </header>
              <dl>
                {detail.fields.map((field) => (
                  <div key={field.name}>
                    <dt>
                      {field.name}
                      {field.sensitive ? <LockKeyhole size={11} /> : null}
                    </dt>
                    <dd className="font-mono">{field.displayValue}</dd>
                  </div>
                ))}
              </dl>
              <div className="traceability">
                <FileSearch size={15} />
                <span>
                  <strong>{detail.sourceFile}</strong>
                  <small>
                    <span className="source-location">
                      {detail.sourceLocation}
                    </span>{" "}
                    · {detail.parser}
                  </small>
                </span>
              </div>
            </aside>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="No local matches"
          description="Try a different safe query mode or remove the dataset filter."
          detail="The query stayed on this computer."
        />
      )}
    </div>
  );
}
