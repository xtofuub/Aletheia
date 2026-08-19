import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FileSearchIcon,
  FolderCogIcon,
  PauseIcon,
  PlayIcon,
  SaveIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { LiveSearchPreflight } from "@/components/live-search-preflight";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDirectSearchProgress } from "@/hooks/use-direct-search-progress";
import {
  exportRecords,
  getSettings,
  listDatasets,
  listLiveSources,
  recordLiveSearchActivity,
  saveSearch,
  searchRecords,
  selectExportDestination,
  startDirectSearch,
  type FieldType,
  type LiveSourceSummary,
  type SearchMode,
} from "@/lib/desktop";
import {
  formatBytes,
  formatDuration,
  formatFileNameForDisplay,
  formatPathForDisplay,
  formatProgressPercent,
} from "@/lib/format";

const modeItems = [
  { label: "Contains", value: "contains" },
  { label: "Exact", value: "exact" },
  { label: "Prefix", value: "prefix" },
];
const fieldItems: Array<{ label: string; value: string }> = [
  { label: "Any indexed field", value: "all" },
  { label: "Email", value: "email" },
  { label: "Domain", value: "domain" },
  { label: "URL", value: "url" },
  { label: "Username", value: "username" },
  { label: "First name", value: "first_name" },
  { label: "Last name", value: "last_name" },
  { label: "Full name", value: "full_name" },
  { label: "Phone", value: "phone" },
  { label: "IP address", value: "ip_address" },
  { label: "User ID", value: "user_id" },
];
const pageItems = [25, 50, 100, 200].map((value) => ({
  label: `${value} per page`,
  value: String(value),
}));
const workerItems = [
  { label: "1 worker · HDD", value: "1" },
  { label: "2 workers · SATA SSD", value: "2" },
  { label: "4 workers · NVMe", value: "4" },
  { label: "8 workers · fast NVMe", value: "8" },
];
const resultCapItems = [
  { label: "First match (fastest)", value: "1" },
  { label: "50 matches", value: "50" },
  { label: "500 matches", value: "500" },
  { label: "2,000 matches", value: "2000" },
  { label: "5,000 matches", value: "5000" },
];

function detectQueryKind(value: string) {
  const query = value.trim();
  if (!query) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) return "Email";
  if (/^(?:https?:\/\/|www\.)/i.test(query)) return "URL";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(query)) return "IP address";
  if (/^\+?[\d\s().-]{7,}$/.test(query)) return "Phone";
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(query)) {
    return "Domain";
  }
  if (/^@[a-z0-9_.-]+$/i.test(query)) return "Username";
  if (/^[\p{L}']+(?:[ -][\p{L}']+){1,3}$/u.test(query)) return "Name";
  return "Text";
}

function parseQueries(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function indexedSourceKey(datasetId: string) {
  return `index:${datasetId}`;
}

function liveSourceKey(sourceId: string) {
  return `live:${sourceId}`;
}

const allLiveSourcesId = "all-saved-live-sources";

export function SearchPage({
  initialQuery = "",
  initialSource = "index:all",
  initialMode = "contains",
  initialField = "all",
}: {
  initialQuery?: string;
  initialSource?: string;
  initialMode?: SearchMode;
  initialField?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sourceKey, setSourceKey] = useState(initialSource);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [submittedSourceKey, setSubmittedSourceKey] = useState(initialSource);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [submittedMode, setSubmittedMode] = useState<SearchMode>(initialMode);
  const [field, setField] = useState(initialField);
  const [submittedField, setSubmittedField] = useState(initialField);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");
  const [includeArchivesOverride, setIncludeArchivesOverride] = useState<
    boolean | null
  >(null);
  const [workerLimitOverride, setWorkerLimitOverride] = useState<number | null>(
    null,
  );
  const [maxResults, setMaxResults] = useState(2_000);
  const [directOffset, setDirectOffset] = useState(0);
  const [directError, setDirectError] = useState("");
  const [directSourceId, setDirectSourceId] = useState<string | null>(null);
  const recordedDirectJobId = useRef<string | null>(null);
  const {
    begin: beginDirectSearch,
    cancel: cancelLiveSearch,
    controlError,
    controlPending,
    pause: pauseLiveSearch,
    progress: globalDirectProgress,
    resume: resumeLiveSearch,
    session: directSession,
  } = useDirectSearchProgress();
  const queryClient = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const workerLimit = workerLimitOverride ?? settings.data?.workerLimit ?? 2;
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const liveSources = useQuery({
    queryKey: ["live-sources"],
    queryFn: listLiveSources,
  });
  const allLiveSources = useMemo<LiveSourceSummary | null>(() => {
    const sources = liveSources.data ?? [];
    if (!sources.length) return null;
    return {
      id: allLiveSourcesId,
      name: "All saved Live sources",
      paths: [...new Set(sources.flatMap((source) => source.paths))],
      includeArchives: sources.some((source) => source.includeArchives),
      createdAt: sources[0]?.createdAt ?? "",
    };
  }, [liveSources.data]);
  const selectedLiveSource = useMemo(() => {
    if (sourceKey === liveSourceKey(allLiveSourcesId)) return allLiveSources;
    return (
      (liveSources.data ?? []).find(
        (source) => liveSourceKey(source.id) === sourceKey,
      ) ?? null
    );
  }, [allLiveSources, liveSources.data, sourceKey]);
  const isLive = sourceKey.startsWith("live:");
  const submittedDatasetId = submittedSourceKey.startsWith("index:")
    ? submittedSourceKey.slice("index:".length)
    : "all";
  const indexed = useQuery({
    queryKey: [
      "search",
      submittedQuery,
      submittedMode,
      submittedField,
      submittedDatasetId,
      offset,
      limit,
    ],
    queryFn: () =>
      searchRecords({
        query: submittedQuery,
        mode: submittedMode,
        datasetId: submittedDatasetId === "all" ? null : submittedDatasetId,
        fieldType:
          submittedField === "all" ? null : (submittedField as FieldType),
        offset,
        limit,
      }),
    enabled:
      submittedQuery.trim().length > 0 &&
      submittedSourceKey.startsWith("index:"),
  });

  const directSearch = useMutation({
    mutationFn: ({
      source,
      value,
    }: {
      source: LiveSourceSummary;
      value: string;
    }) =>
      startDirectSearch({
        paths: source.paths,
        query: value,
        mode,
        caseSensitive: false,
        includeArchives: includeArchivesOverride ?? source.includeArchives,
        maxResults,
        workerLimit,
        sessionContext: {
          scope: "search",
          sourceId: source.id,
          sourceName: source.name,
        },
      }),
    onSuccess: (start, variables) => {
      setDirectError("");
      setDirectSourceId(variables.source.id);
      beginDirectSearch(start, {
        scope: "search",
        query: variables.value,
        sourceId: variables.source.id,
        sourceName: variables.source.name,
      });
    },
    onError: (error) => setDirectError(String(error)),
  });

  const indexedItems = useMemo(
    () => [
      {
        label: `All indexed datasets (${(datasets.data ?? []).length})`,
        value: "index:all",
      },
      ...(datasets.data ?? []).map((dataset) => ({
        label: dataset.name,
        value: indexedSourceKey(dataset.id),
      })),
    ],
    [datasets.data],
  );
  const liveItems = useMemo(
    () => [
      ...(allLiveSources
        ? [
            {
              label: `All saved Live sources (${(liveSources.data ?? []).length})`,
              value: liveSourceKey(allLiveSources.id),
            },
          ]
        : []),
      ...(liveSources.data ?? []).map((source) => ({
        label: source.name,
        value: liveSourceKey(source.id),
      })),
    ],
    [allLiveSources, liveSources.data],
  );
  const sourceItems = useMemo(
    () => [...indexedItems, ...liveItems],
    [indexedItems, liveItems],
  );
  const queries = parseQueries(query);
  const queryKind =
    queries.length > 1 ? "Batch" : detectQueryKind(queries[0] ?? "");
  const directProgress =
    directSession?.scope === "search" ? globalDirectProgress : null;

  useEffect(() => {
    if (
      directSession?.scope !== "search" ||
      !directSession.sourceId ||
      directSourceId === directSession.sourceId
    ) {
      return;
    }
    const sourceId = directSession.sourceId;
    const timer = window.setTimeout(() => {
      setDirectSourceId(sourceId);
      setSourceKey(liveSourceKey(sourceId));
      if (directSession.query) setQuery(directSession.query);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [directSession, directSourceId]);

  const currentLiveProgress =
    selectedLiveSource?.id === directSourceId ? directProgress : null;
  const directPercent = currentLiveProgress?.totalBytes
    ? Math.min(
        100,
        (currentLiveProgress.sourceBytesScanned /
          currentLiveProgress.totalBytes) *
          100,
      )
    : 0;
  const visibleDirectHits = (currentLiveProgress?.hits ?? []).slice(
    directOffset,
    directOffset + limit,
  );
  const hits = indexed.data?.hits ?? [];
  const allVisibleSelected =
    hits.length > 0 && hits.every((hit) => selected.has(hit.recordId));
  const liveBusy =
    directSearch.isPending ||
    ["running", "paused", "cancelling"].includes(
      currentLiveProgress?.status ?? "",
    );

  useEffect(() => {
    if (
      directProgress?.status !== "completed" ||
      directProgress.jobId === recordedDirectJobId.current ||
      !directSourceId
    ) {
      return;
    }
    const source =
      directSourceId === allLiveSourcesId
        ? allLiveSources
        : (liveSources.data ?? []).find((item) => item.id === directSourceId);
    if (!source) return;
    recordedDirectJobId.current = directProgress.jobId;
    void recordLiveSearchActivity({
      jobId: directProgress.jobId,
      sourceId: source.id,
      sourceName: source.name,
      matches: directProgress.matches,
      filesScanned: directProgress.filesScanned,
      bytesScanned: directProgress.sourceBytesScanned,
      completedAt: new Date().toISOString(),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["overview"] }))
      .catch(() => undefined);
  }, [
    allLiveSources,
    directProgress,
    directSourceId,
    liveSources.data,
    queryClient,
  ]);

  function submitSearch() {
    const value = query.trim();
    if (!value) return;
    setNotice("");
    setDirectError("");
    setOffset(0);
    setDirectOffset(0);
    setSelected(new Set());
    if (isLive) {
      if (!selectedLiveSource) {
        setDirectError("Choose a saved Live source first.");
        return;
      }
      directSearch.mutate({ source: selectedLiveSource, value });
      return;
    }
    if (queries.length > 1) {
      setDirectError(
        "Indexed sources accept one query at a time. Choose a Live source to scan a batch.",
      );
      return;
    }
    setSubmittedSourceKey(sourceKey);
    setSubmittedMode(mode);
    setSubmittedField(field);
    setSubmittedQuery(value);
  }

  async function exportSelected() {
    if (!selected.size) return;
    const destinationPath = await selectExportDestination("csv");
    if (!destinationPath) return;
    const result = await exportRecords({
      destinationPath,
      format: "csv",
      recordIds: [...selected],
      maskEmailLocalPart: false,
    });
    setNotice(`Exported ${result.recordCount} records.`);
    await queryClient.invalidateQueries({ queryKey: ["exports"] });
  }

  const selectedSourceDescription = isLive
    ? selectedLiveSource
      ? `${selectedLiveSource.paths.length} saved ${
          selectedLiveSource.paths.length === 1 ? "location" : "locations"
        } · scans source files on demand`
      : "Add a Live source on the Datasets page."
    : sourceKey === "index:all"
      ? "Fast lookup across every persistent index."
      : "Fast lookup inside one persistent index.";

  return (
    <div>
      <PageHeader
        description="Search a persistent index or scan a saved large source from the same place."
        title="Search"
      />
      <div className="flex flex-col gap-px bg-border p-px">
        <DashboardCard className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Search workspace</CardTitle>
            <CardDescription>{selectedSourceDescription}</CardDescription>
            <CardAction>
              <Badge variant={isLive ? "default" : "outline"}>
                {isLive ? (
                  <FileSearchIcon data-icon="inline-start" />
                ) : (
                  <DatabaseIcon data-icon="inline-start" />
                )}
                {isLive ? "Live source" : "Indexed"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 p-4">
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(15rem,0.55fr)_minmax(0,1fr)]">
                <Field>
                  <FieldLabel>Search source</FieldLabel>
                  <Select
                    items={sourceItems}
                    onValueChange={(value) => {
                      setSourceKey(String(value));
                      setIncludeArchivesOverride(null);
                      setDirectError("");
                    }}
                    value={sourceKey}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a search source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Persistent indexes</SelectLabel>
                        {indexedItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            <DatabaseIcon />
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {liveItems.length ? <SelectSeparator /> : null}
                      {liveItems.length ? (
                        <SelectGroup>
                          <SelectLabel>Saved Live sources</SelectLabel>
                          {liveItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              <FileSearchIcon />
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="workspace-search-query">
                    Query
                  </FieldLabel>
                  {isLive ? (
                    <InputGroup>
                      <InputGroupTextarea
                        aria-label="Search query"
                        autoFocus
                        className="min-h-20"
                        id="workspace-search-query"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            (event.ctrlKey || event.metaKey)
                          ) {
                            event.preventDefault();
                            submitSearch();
                          }
                        }}
                        placeholder="Paste up to 512 values, one per line"
                        rows={3}
                        value={query}
                      />
                      <InputGroupAddon align="block-end" className="border-t">
                        <InputGroupText>
                          {queries.length
                            ? `${queries.length} ${queries.length === 1 ? "value" : "values"}`
                            : "Up to 512 values"}
                        </InputGroupText>
                        {queryKind ? (
                          <Badge variant="secondary">{queryKind}</Badge>
                        ) : null}
                        <InputGroupButton
                          className="ms-auto"
                          disabled={
                            !query.trim() ||
                            directSearch.isPending ||
                            ["running", "paused", "cancelling"].includes(
                              currentLiveProgress?.status ?? "",
                            )
                          }
                          size="sm"
                          type="submit"
                          variant="default"
                        >
                          {directSearch.isPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <FileSearchIcon data-icon="inline-start" />
                          )}
                          {directSearch.isPending ? "Scanning…" : "Scan"}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  ) : (
                    <InputGroup>
                      <InputGroupInput
                        aria-label="Search query"
                        autoFocus
                        id="workspace-search-query"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitSearch();
                          }
                        }}
                        placeholder="Name, email, domain, username, phone, IP, or URL"
                        value={query}
                      />
                      <InputGroupAddon align="inline-start">
                        <SearchIcon />
                      </InputGroupAddon>
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          disabled={!query.trim() || indexed.isFetching}
                          size="sm"
                          type="submit"
                          variant="default"
                        >
                          {indexed.isFetching ? (
                            <Spinner data-icon="inline-start" />
                          ) : null}
                          {indexed.isFetching ? "Searching…" : "Search"}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field className="w-auto">
                  <FieldLabel className="sr-only">Match mode</FieldLabel>
                  <Select
                    items={modeItems}
                    onValueChange={(value) => setMode(value as SearchMode)}
                    value={mode}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {modeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {!isLive ? (
                  <Field className="w-auto">
                    <FieldLabel className="sr-only">Search field</FieldLabel>
                    <Select
                      items={fieldItems}
                      onValueChange={(value) => setField(String(value))}
                      value={field}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {fieldItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Field className="w-auto">
                  <FieldLabel className="sr-only">Page size</FieldLabel>
                  <Select
                    items={pageItems}
                    onValueChange={(value) => {
                      setLimit(Number(value));
                      setOffset(0);
                      setDirectOffset(0);
                    }}
                    value={String(limit)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {pageItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  className="ms-auto"
                  nativeButton={false}
                  render={<a href="#/datasets" />}
                  size="sm"
                  variant="ghost"
                >
                  <FolderCogIcon data-icon="inline-start" />
                  Manage sources
                </Button>
              </div>
            </form>

            {isLive ? (
              <Collapsible>
                <CollapsibleTrigger
                  render={<Button size="sm" variant="ghost" />}
                >
                  <SlidersHorizontalIcon data-icon="inline-start" />
                  Live scan options
                  <ChevronDownIcon data-icon="inline-end" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="grid grid-cols-1 gap-3 border p-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel>Worker limit</FieldLabel>
                      <Select
                        items={workerItems}
                        onValueChange={(value) =>
                          setWorkerLimitOverride(Number(value))
                        }
                        value={String(workerLimit)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {workerItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Result cap</FieldLabel>
                      <Select
                        items={resultCapItems}
                        onValueChange={(value) => setMaxResults(Number(value))}
                        value={String(maxResults)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {resultCapItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field orientation="horizontal">
                      <div>
                        <FieldLabel>Archive entries</FieldLabel>
                        <p className="text-xs text-muted-foreground">
                          ZIP, RAR, and GZIP
                        </p>
                      </div>
                      <Switch
                        checked={
                          includeArchivesOverride ??
                          selectedLiveSource?.includeArchives ??
                          true
                        }
                        onCheckedChange={setIncludeArchivesOverride}
                      />
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {isLive ? (
              <LiveSearchPreflight
                currentWorkerLimit={workerLimit}
                includeArchives={
                  includeArchivesOverride ??
                  selectedLiveSource?.includeArchives ??
                  true
                }
                onUseRecommendedWorkers={setWorkerLimitOverride}
                source={selectedLiveSource}
              />
            ) : null}

            {directError || controlError ? (
              <Alert variant="destructive">
                <AlertTitle>Search could not start</AlertTitle>
                <AlertDescription>
                  {directError || controlError}
                </AlertDescription>
              </Alert>
            ) : null}

            {isLive && currentLiveProgress ? (
              <div className="flex flex-col gap-3 border p-3">
                <Progress value={directPercent}>
                  <ProgressLabel className="flex items-center gap-2">
                    {currentLiveProgress.status === "running" ? (
                      <Spinner />
                    ) : null}
                    {currentLiveProgress.message}
                  </ProgressLabel>
                  <ProgressValue>
                    {() => formatProgressPercent(directPercent)}
                  </ProgressValue>
                </Progress>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {formatBytes(currentLiveProgress.bytesPerSecond)}/s
                  </Badge>
                  <Badge variant="outline">
                    {currentLiveProgress.filesScanned.toLocaleString()} /{" "}
                    {currentLiveProgress.sourceCount.toLocaleString()} files
                  </Badge>
                  <Badge variant="outline">
                    {currentLiveProgress.matches.toLocaleString()} matches
                  </Badge>
                  <Badge variant="outline">
                    {currentLiveProgress.status === "completed"
                      ? "Done"
                      : `${formatDuration(
                          currentLiveProgress.estimatedRemainingMs,
                        )} remaining`}
                  </Badge>
                  <div className="ms-auto flex gap-2">
                    {currentLiveProgress.status === "running" ? (
                      <Button
                        disabled={controlPending !== null}
                        onClick={() =>
                          void pauseLiveSearch(currentLiveProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <PauseIcon data-icon="inline-start" />
                        Pause
                      </Button>
                    ) : null}
                    {currentLiveProgress.status === "paused" ? (
                      <Button
                        disabled={controlPending !== null}
                        onClick={() =>
                          void resumeLiveSearch(currentLiveProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <PlayIcon data-icon="inline-start" />
                        Resume
                      </Button>
                    ) : null}
                    {["running", "paused", "cancelling"].includes(
                      currentLiveProgress.status,
                    ) ? (
                      <Button
                        disabled={controlPending !== null}
                        onClick={() =>
                          void cancelLiveSearch(currentLiveProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <SquareIcon data-icon="inline-start" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </DashboardCard>

        <DashboardCard className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {isLive
                ? currentLiveProgress
                  ? `${currentLiveProgress.hits.length.toLocaleString()} rows collected`
                  : "Search the selected Live source to stream matching rows."
                : indexed.data
                  ? `${indexed.data.total.toLocaleString()} matches`
                  : "Search the selected index to load local evidence."}
            </CardDescription>
            <CardAction>
              {isLive ? (
                <Badge variant="outline">
                  <ArchiveIcon data-icon="inline-start" />
                  No index required
                </Badge>
              ) : indexed.isFetching ? (
                <Badge variant="outline">
                  <Spinner />
                  Searching index
                </Badge>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {isLive ? (
              visibleDirectHits.length ? (
                <ScrollArea className="h-[min(52vh,34rem)]">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/4 ps-6">Source</TableHead>
                        <TableHead className="w-1/6">Location</TableHead>
                        <TableHead className="w-5/12">Row</TableHead>
                        <TableHead className="pe-6">Match</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleDirectHits.map((hit) => (
                        <TableRow key={hit.id}>
                          <TableCell className="min-w-0 ps-6 whitespace-normal">
                            <p className="break-all">
                              {hit.archiveEntry ??
                                formatFileNameForDisplay(hit.sourceFile)}
                            </p>
                            {hit.archiveEntry ? (
                              <p className="break-all text-xs text-muted-foreground">
                                {formatFileNameForDisplay(hit.sourceFile)}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs break-all whitespace-normal">
                            {hit.sourceLocation}
                          </TableCell>
                          <TableCell className="font-mono text-xs break-all whitespace-pre-wrap">
                            {hit.excerpt}
                          </TableCell>
                          <TableCell className="pe-6 text-xs whitespace-normal text-muted-foreground">
                            <p className="break-all font-mono text-foreground">
                              {hit.matchedQuery}
                            </p>
                            <p className="break-words">{hit.matchReason}</p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <Empty className="min-h-72 rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {liveBusy ? <Spinner /> : <FileSearchIcon />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {liveBusy ? "Scanning saved source" : "No live results"}
                    </EmptyTitle>
                    <EmptyDescription>
                      Select a saved Live source, enter a value, and search.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            ) : hits.length ? (
              <ScrollArea className="h-[min(52vh,34rem)]">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 ps-4">
                        <Checkbox
                          aria-label="Select visible results"
                          checked={allVisibleSelected}
                          onCheckedChange={(checked) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              hits.forEach((hit) =>
                                checked
                                  ? next.add(hit.recordId)
                                  : next.delete(hit.recordId),
                              );
                              return next;
                            });
                          }}
                        />
                      </TableHead>
                      <TableHead className="w-5/12">Evidence</TableHead>
                      <TableHead className="w-1/6">Dataset</TableHead>
                      <TableHead className="w-1/4">Source</TableHead>
                      <TableHead className="pe-4">Match</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hits.map((hit) => (
                      <TableRow key={hit.recordId}>
                        <TableCell className="ps-4">
                          <Checkbox
                            aria-label={`Select ${hit.recordId}`}
                            checked={selected.has(hit.recordId)}
                            onCheckedChange={(checked) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (checked) next.add(hit.recordId);
                                else next.delete(hit.recordId);
                                return next;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-normal">
                          <p
                            className="font-mono text-xs break-all"
                            data-slot="search-field-value"
                            title={hit.fields
                              .map((item) => item.displayValue)
                              .join(" | ")}
                          >
                            {hit.fields
                              .map((item) => item.displayValue)
                              .join(" | ") || "No displayable values"}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-normal">
                          <p className="break-all">{hit.datasetName}</p>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-normal">
                          <p
                            className="break-all text-xs"
                            title={formatPathForDisplay(hit.sourceFile)}
                          >
                            {formatFileNameForDisplay(hit.sourceFile)}
                          </p>
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {hit.sourceLocation}
                          </p>
                        </TableCell>
                        <TableCell className="pe-4 text-xs break-words whitespace-normal text-muted-foreground">
                          {hit.matchReason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <Empty className="min-h-72 rounded-none border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {indexed.isFetching ? <Spinner /> : <SearchIcon />}
                  </EmptyMedia>
                  <EmptyTitle>
                    {indexed.isFetching
                      ? "Searching"
                      : submittedQuery
                        ? "No matches"
                        : "Search the index"}
                  </EmptyTitle>
                  <EmptyDescription>
                    Enter a value to search the selected index.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
          {isLive && currentLiveProgress?.hits.length ? (
            <PaginationControls
              label="live scan results"
              limit={limit}
              offset={directOffset}
              onOffsetChange={setDirectOffset}
              total={currentLiveProgress.hits.length}
            />
          ) : null}
          {!isLive && indexed.data ? (
            <PaginationControls
              label="search results"
              limit={limit}
              offset={offset}
              onOffsetChange={setOffset}
              total={indexed.data.total}
            />
          ) : null}
          {!isLive ? (
            <CardFooter className="justify-between gap-2 rounded-none bg-background">
              <p className="text-xs text-muted-foreground">
                {notice || `${selected.size} selected`}
              </p>
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        disabled={!submittedQuery}
                        size="sm"
                        variant="outline"
                      />
                    }
                  >
                    <SaveIcon data-icon="inline-start" />
                    Save view
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Save search view</DialogTitle>
                      <DialogDescription>
                        Store this query and its current filters locally.
                      </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="saved-search-name">
                          Name
                        </FieldLabel>
                        <Input
                          id="saved-search-name"
                          onChange={(event) => setSaveName(event.target.value)}
                          value={saveName}
                        />
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <Button
                        disabled={!saveName.trim()}
                        onClick={() =>
                          void saveSearch(
                            saveName.trim(),
                            submittedQuery,
                            JSON.stringify({
                              mode: submittedMode,
                              field: submittedField,
                              sourceKey: submittedSourceKey,
                            }),
                          ).then(() => {
                            setNotice("Saved view created.");
                            setSaveName("");
                            void queryClient.invalidateQueries({
                              queryKey: ["saved-searches"],
                            });
                          })
                        }
                      >
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  disabled={!selected.size}
                  onClick={() => void exportSelected()}
                  size="sm"
                >
                  Export selected
                </Button>
              </div>
            </CardFooter>
          ) : null}
        </DashboardCard>
      </div>
    </div>
  );
}
