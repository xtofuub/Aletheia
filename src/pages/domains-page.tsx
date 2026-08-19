import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FileSearchIcon,
  Globe2Icon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { LiveSearchPreflight } from "@/components/live-search-preflight";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
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
  clearLiveDomainEvidence,
  getSettings,
  getDomainDetails,
  listDomains,
  listDatasets,
  listLiveDomainCollections,
  listLiveDomainEvidence,
  listLiveSources,
  rebuildDomains,
  saveLiveDomainEvidence,
  startDirectSearch,
  type LiveSourceSummary,
} from "@/lib/desktop";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatFileNameForDisplay,
  formatPathForDisplay,
  formatProgressPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const pageSize = 25;
const allLiveSourcesId = "all-saved-live-sources";
const sourceViewStorageKey = "aletheia.domains.source-view";

function initialSourceView(): "live" | "indexed" {
  return window.sessionStorage.getItem(sourceViewStorageKey) === "live"
    ? "live"
    : "indexed";
}

function isDomainQuery(value: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    value.trim(),
  );
}

export function DomainsPage() {
  const queryClient = useQueryClient();
  const [sourceView, setSourceView] = useState<"live" | "indexed">(
    initialSourceView,
  );
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [hostnameQuery, setHostnameQuery] = useState("");
  const [submittedHostnameQuery, setSubmittedHostnameQuery] = useState("");
  const [datasetId, setDatasetId] = useState("all");
  const [recordOffset, setRecordOffset] = useState(0);
  const [liveRecordOffset, setLiveRecordOffset] = useState(0);
  const [liveSourceId, setLiveSourceId] = useState(allLiveSourcesId);
  const [liveDomainInput, setLiveDomainInput] = useState("");
  const [repairNotice, setRepairNotice] = useState("");
  const [liveNotice, setLiveNotice] = useState("");
  const checkpointedLiveHits = useRef({ count: 0, domain: "", jobId: "" });
  const checkpointSaving = useRef(false);
  const attemptedCheckpointKey = useRef<string | null>(null);
  const [liveCheckpointPending, setLiveCheckpointPending] = useState(false);
  const [savedLiveHitCount, setSavedLiveHitCount] = useState(0);
  const {
    begin: beginDirectSearch,
    cancel: cancelLiveSearch,
    controlError,
    controlPending,
    markHandled,
    pause: pauseLiveSearch,
    progress: directProgress,
    resume: resumeLiveSearch,
    session: directSession,
  } = useDirectSearchProgress();

  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
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
  const selectedLiveSource =
    liveSourceId === allLiveSourcesId
      ? allLiveSources
      : ((liveSources.data ?? []).find(
          (source) => source.id === liveSourceId,
        ) ?? allLiveSources);
  const liveSourceItems = [
    ...(allLiveSources
      ? [
          {
            label: `All saved Live sources (${(liveSources.data ?? []).length})`,
            value: allLiveSourcesId,
          },
        ]
      : []),
    ...(liveSources.data ?? []).map((source) => ({
      label: source.name,
      value: source.id,
    })),
  ];

  const domainRepair = useMutation({
    mutationFn: rebuildDomains,
    onMutate: () => setRepairNotice(""),
    onSuccess: async (count) => {
      setRepairNotice(
        `${formatCount(count)} parent domain groups are ready, including their linked subdomains.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
        queryClient.invalidateQueries({ queryKey: ["domain-details"] }),
      ]);
    },
    onError: (error) => setRepairNotice(String(error)),
  });

  const domains = useQuery({
    queryKey: ["domains", submittedQuery, datasetId, offset],
    queryFn: () =>
      listDomains(
        submittedQuery,
        offset,
        pageSize,
        datasetId === "all" ? null : datasetId,
      ),
    enabled: sourceView === "indexed",
  });

  const storedCollections = useQuery({
    queryKey: ["live-domain-collections", submittedQuery, offset],
    queryFn: () => listLiveDomainCollections(submittedQuery, offset, pageSize),
    enabled: sourceView === "live",
  });

  const activeDomain =
    selectedDomain ??
    (sourceView === "live"
      ? storedCollections.data?.collections[0]?.registrableDomain
      : domains.data?.groups[0]?.registrableDomain) ??
    null;

  const details = useQuery({
    queryKey: [
      "domain-details",
      activeDomain,
      hostname,
      submittedHostnameQuery,
      datasetId,
      recordOffset,
    ],
    queryFn: () =>
      getDomainDetails(
        activeDomain ?? "",
        hostname,
        submittedHostnameQuery || null,
        datasetId === "all" ? null : datasetId,
        recordOffset,
        pageSize,
      ),
    enabled: sourceView === "indexed" && Boolean(activeDomain),
  });

  const liveEvidence = useQuery({
    queryKey: ["live-domain-evidence", activeDomain, liveRecordOffset],
    queryFn: () =>
      listLiveDomainEvidence(activeDomain ?? "", liveRecordOffset, pageSize),
    enabled: sourceView === "live" && Boolean(activeDomain),
  });

  const clearLiveCollection = useMutation({
    mutationFn: (domain: string) => clearLiveDomainEvidence(domain),
    onSuccess: (removed, domain) => {
      if (selectedDomain === domain) {
        setSelectedDomain(null);
        setLiveRecordOffset(0);
      }
      setLiveNotice(
        `${formatCount(removed)} saved Live ${removed === 1 ? "row" : "rows"} deleted`,
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["live-domain-collections"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["live-domain-evidence", domain],
        }),
      ]);
    },
    onError: (error) =>
      setLiveNotice(`Could not delete saved results: ${String(error)}`),
  });

  const liveScan = useMutation({
    mutationFn: ({
      domain,
      source,
    }: {
      domain: string;
      source: LiveSourceSummary;
    }) =>
      startDirectSearch({
        paths: source.paths,
        query: domain,
        mode: "contains",
        domainMatch: true,
        caseSensitive: false,
        includeArchives: source.includeArchives,
        maxResults: 5_000,
        workerLimit: settings.data?.workerLimit ?? 2,
        sessionContext: {
          scope: "domains",
          sourceId: source.id,
          sourceName: source.name,
        },
        liveDomainAutosave: {
          domain,
          sourceId: source.id,
          sourceName: source.name,
        },
      }),
    onSuccess: (start, variables) => {
      checkpointedLiveHits.current = {
        count: 0,
        domain: "",
        jobId: start.jobId,
      };
      attemptedCheckpointKey.current = null;
      setSavedLiveHitCount(0);
      setLiveNotice("");
      beginDirectSearch(start, {
        scope: "domains",
        query: variables.domain,
        sourceId: variables.source.id,
        sourceName: variables.source.name,
      });
    },
    onError: (error) => setLiveNotice(`Live scan failed: ${String(error)}`),
  });

  const liveScanContext =
    directSession?.scope === "domains" ? directSession : null;
  useEffect(() => {
    if (!liveScanContext) return;
    const timer = window.setTimeout(() => {
      setSourceView("live");
      if (liveScanContext.sourceId) setLiveSourceId(liveScanContext.sourceId);
      if (liveScanContext.query) setLiveDomainInput(liveScanContext.query);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [liveScanContext]);
  const currentLiveProgress =
    liveScanContext &&
    !liveScanContext.handled &&
    liveScanContext.jobId === directProgress?.jobId
      ? directProgress
      : null;
  const livePercent =
    currentLiveProgress?.status === "completed"
      ? 100
      : currentLiveProgress?.totalBytes
        ? Math.min(
            100,
            (currentLiveProgress.sourceBytesScanned /
              currentLiveProgress.totalBytes) *
              100,
          )
        : 0;
  const displayedSavedLiveHitCount = currentLiveProgress?.autosaveEnabled
    ? (currentLiveProgress.savedMatches ?? currentLiveProgress.hits.length)
    : savedLiveHitCount;

  useEffect(() => {
    if (!currentLiveProgress || !liveScanContext || liveScanContext.handled)
      return;
    if (currentLiveProgress.autosaveEnabled) {
      const stored =
        currentLiveProgress.savedMatches ?? currentLiveProgress.hits.length;
      checkpointedLiveHits.current = {
        count: currentLiveProgress.hits.length,
        domain: liveScanContext.query ?? "",
        jobId: currentLiveProgress.jobId,
      };
      const final = ["completed", "cancelled", "failed"].includes(
        currentLiveProgress.status,
      );
      if (!final) return;
      queueMicrotask(() => {
        if (stored > 0) {
          setSelectedDomain(liveScanContext.query ?? null);
          setLiveRecordOffset(0);
          setLiveNotice(
            currentLiveProgress.status === "completed"
              ? `${formatCount(stored)} Live rows saved locally`
              : `${formatCount(stored)} partial Live ${stored === 1 ? "row" : "rows"} saved locally after the scan stopped`,
          );
        } else if (currentLiveProgress.status === "cancelled") {
          setLiveNotice("Scan cancelled. No matching rows were found to save.");
        } else if (currentLiveProgress.status === "failed") {
          setLiveNotice(currentLiveProgress.message);
        }
        markHandled(currentLiveProgress.jobId);
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["live-domain-collections"],
          }),
          queryClient.invalidateQueries({
            queryKey: ["live-domain-evidence"],
          }),
        ]);
      });
      return;
    }
    if (checkpointSaving.current) return;
    const final = ["completed", "cancelled", "failed"].includes(
      currentLiveProgress.status,
    );
    const checkpoint =
      checkpointedLiveHits.current.jobId === currentLiveProgress.jobId
        ? checkpointedLiveHits.current.count
        : 0;
    if (currentLiveProgress.hits.length <= checkpoint) {
      if (!final) return;
      if (currentLiveProgress.hits.length > 0) {
        setSelectedDomain(checkpointedLiveHits.current.domain || null);
        setLiveRecordOffset(0);
        setLiveNotice(
          currentLiveProgress.status === "completed"
            ? `${formatCount(savedLiveHitCount)} Live rows saved locally`
            : `${formatCount(savedLiveHitCount)} partial Live ${savedLiveHitCount === 1 ? "row" : "rows"} saved locally after the scan stopped`,
        );
      } else if (currentLiveProgress.status === "cancelled") {
        setLiveNotice("Scan cancelled. No matching rows were found to save.");
      } else if (currentLiveProgress.status === "failed") {
        setLiveNotice(currentLiveProgress.message);
      }
      markHandled(currentLiveProgress.jobId);
      return;
    }
    const checkpointKey = `${currentLiveProgress.jobId}:${currentLiveProgress.hits.length}:${currentLiveProgress.status}`;
    if (attemptedCheckpointKey.current === checkpointKey) return;
    attemptedCheckpointKey.current = checkpointKey;
    checkpointSaving.current = true;
    setLiveCheckpointPending(true);
    const jobId = currentLiveProgress.jobId;
    const status = currentLiveProgress.status;
    const upToHitCount = currentLiveProgress.hits.length;
    void saveLiveDomainEvidence({
      domain: liveScanContext.query ?? "",
      sourceId: liveScanContext.sourceId ?? "live-source",
      sourceName: liveScanContext.sourceName ?? "Saved Live source",
      evidence: currentLiveProgress.hits.slice(checkpoint),
    })
      .then((summary) => {
        checkpointedLiveHits.current = {
          count: upToHitCount,
          domain: summary.registrableDomain,
          jobId,
        };
        attemptedCheckpointKey.current = null;
        setSavedLiveHitCount(summary.evidenceCount);
        if (final) {
          setSelectedDomain(summary.registrableDomain);
          setLiveRecordOffset(0);
          setLiveNotice(
            status === "completed"
              ? `${formatCount(summary.evidenceCount)} Live rows saved locally`
              : `${formatCount(summary.evidenceCount)} partial Live ${summary.evidenceCount === 1 ? "row" : "rows"} saved locally after the scan stopped`,
          );
          markHandled(jobId);
        }
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["live-domain-collections"],
          }),
          queryClient.invalidateQueries({
            queryKey: ["live-domain-evidence", summary.registrableDomain],
          }),
        ]);
      })
      .catch((error: unknown) => {
        setLiveNotice(`Could not autosave Live results: ${String(error)}`);
      })
      .finally(() => {
        checkpointSaving.current = false;
        setLiveCheckpointPending(false);
      });
  }, [
    currentLiveProgress,
    liveCheckpointPending,
    liveScanContext,
    markHandled,
    queryClient,
    savedLiveHitCount,
  ]);

  const datasetItems = [
    {
      label: `All indexed datasets (${(datasets.data ?? []).filter((dataset) => dataset.recordCount > 0).length})`,
      value: "all",
    },
    ...(datasets.data ?? [])
      .filter((dataset) => dataset.recordCount > 0)
      .map((dataset) => ({
        label: `${dataset.name} (${formatCount(dataset.recordCount)} records)`,
        value: dataset.id,
      })),
  ];
  const selectedIndexedDataset = (datasets.data ?? []).find(
    (dataset) => dataset.id === datasetId,
  );
  const domainToScan = liveDomainInput.trim();
  const liveBusy =
    liveScan.isPending ||
    liveCheckpointPending ||
    ["running", "paused", "cancelling"].includes(
      currentLiveProgress?.status ?? "",
    );
  const completedWithoutLiveMatches = Boolean(
    liveScanContext?.handled &&
    directProgress?.jobId === liveScanContext.jobId &&
    directProgress.status === "completed" &&
    directProgress.hits.length === 0,
  );
  const displayedLiveNotice =
    liveNotice ||
    controlError ||
    (currentLiveProgress?.status === "failed"
      ? currentLiveProgress.message
      : currentLiveProgress?.status === "completed" &&
          currentLiveProgress.hits.length === 0
        ? "Live scan completed with no matching rows."
        : completedWithoutLiveMatches
          ? "Live scan completed with no matching rows."
          : "");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = query.trim();
      if (value === submittedQuery) return;
      setOffset(0);
      setSelectedDomain(
        sourceView === "indexed" && isDomainQuery(value)
          ? value.toLowerCase()
          : null,
      );
      setSubmittedQuery(value);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, sourceView, submittedQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubmittedHostnameQuery(hostnameQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hostnameQuery]);

  return (
    <div>
      <PageHeader
        actions={
          sourceView === "indexed" ? (
            <Button
              disabled={domainRepair.isPending}
              onClick={() => domainRepair.mutate()}
              size="sm"
              variant="outline"
            >
              {domainRepair.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {domainRepair.isPending
                ? "Building all domains…"
                : "Build all domains"}
            </Button>
          ) : null
        }
        description="Choose an indexed dataset for instant domain lookup, or scan saved Live sources on demand."
        title="Domains"
      />
      {domainRepair.isPending ? (
        <Alert className="mb-4" role="status">
          <Spinner />
          <AlertTitle>Building every indexed domain</AlertTitle>
          <AlertDescription>
            Scanning indexed fields and linking parent domains with their
            subdomains. No search term is needed; large indexes can take time.
          </AlertDescription>
        </Alert>
      ) : repairNotice ? (
        <Alert
          className="mb-4"
          role="status"
          variant={domainRepair.isError ? "destructive" : "default"}
        >
          {domainRepair.isError ? <AlertCircleIcon /> : <CheckCircle2Icon />}
          <AlertTitle>
            {domainRepair.isError
              ? "Domain build failed"
              : "Domain catalog ready"}
          </AlertTitle>
          <AlertDescription>{repairNotice}</AlertDescription>
        </Alert>
      ) : null}
      <Field className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel>Evidence source</FieldLabel>
          <FieldDescription>
            {sourceView === "indexed"
              ? "Browse domain groups already extracted from persistent indexes."
              : "Search saved files, folders, and archives without indexing them first."}
          </FieldDescription>
        </div>
        <ToggleGroup
          aria-label="Domain evidence source"
          onValueChange={(values) => {
            const nextView = values[0] as "live" | "indexed" | undefined;
            if (!nextView) return;
            setSourceView(nextView);
            window.sessionStorage.setItem(sourceViewStorageKey, nextView);
            setOffset(0);
            setSelectedDomain(null);
            setHostname(null);
            setDatasetId("all");
            setRecordOffset(0);
            setLiveRecordOffset(0);
            setQuery("");
            setSubmittedQuery("");
          }}
          size="sm"
          value={[sourceView]}
          variant="outline"
        >
          <ToggleGroupItem value="indexed">
            <DatabaseIcon data-icon="inline-start" />
            Indexed datasets
          </ToggleGroupItem>
          <ToggleGroupItem value="live">
            <ArchiveIcon data-icon="inline-start" />
            Live source scans
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <div className="grid grid-cols-1 gap-px bg-border p-px xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <DashboardCard className="min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>
              {sourceView === "live"
                ? "Live domain scans"
                : "Indexed domain groups"}
            </CardTitle>
            <CardDescription>
              {sourceView === "live"
                ? `${storedCollections.data?.total ?? 0} saved result groups`
                : `${domains.data?.total ?? 0} groups · ${selectedIndexedDataset?.name ?? "all indexed datasets"}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-3">
            {sourceView === "indexed" ? (
              <Field>
                <FieldLabel>Indexed dataset</FieldLabel>
                <Select
                  items={datasetItems}
                  onValueChange={(value) => {
                    setDatasetId(String(value));
                    setOffset(0);
                    setSelectedDomain(null);
                    setHostname(null);
                    setRecordOffset(0);
                  }}
                  value={datasetId}
                >
                  <SelectTrigger aria-label="Indexed dataset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {datasetItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Group counts and linked lines stay inside this dataset scope.
                </FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="domain-filter">
                {sourceView === "live"
                  ? "Filter saved results"
                  : "Filter domain catalog"}
              </FieldLabel>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setOffset(0);
                  setSelectedDomain(null);
                  setSubmittedQuery(query.trim());
                }}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search domains"
                    id="domain-filter"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      sourceView === "live"
                        ? "Find a saved domain"
                        : "Parent domain or subdomain"
                    }
                    value={query}
                  />
                  {(
                    sourceView === "live"
                      ? storedCollections.isFetching
                      : domains.isFetching
                  ) ? (
                    <InputGroupAddon align="inline-end">
                      <Spinner />
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </form>
              <FieldDescription>
                {sourceView === "live"
                  ? "This only filters domain scans already stored on this device."
                  : "Leave empty to browse every domain built from the selected index."}
              </FieldDescription>
            </Field>
            {sourceView === "live" ? (
              <>
                <Separator />
                <FieldSet>
                  <FieldLegend>New Live domain scan</FieldLegend>
                  <FieldDescription>
                    Search saved files, folders, ZIPs, and RARs without building
                    a persistent index.
                  </FieldDescription>
                  {liveSourceItems.length ? (
                    <>
                      <FieldGroup className="gap-4">
                        <Field
                          data-invalid={
                            Boolean(liveDomainInput.trim()) &&
                            !isDomainQuery(liveDomainInput)
                          }
                        >
                          <FieldLabel htmlFor="live-domain-input">
                            Parent domain
                          </FieldLabel>
                          <InputGroup>
                            <InputGroupAddon>
                              <Globe2Icon />
                            </InputGroupAddon>
                            <InputGroupInput
                              aria-invalid={
                                Boolean(liveDomainInput.trim()) &&
                                !isDomainQuery(liveDomainInput)
                              }
                              id="live-domain-input"
                              onChange={(event) =>
                                setLiveDomainInput(event.target.value)
                              }
                              placeholder="example.com"
                              value={liveDomainInput}
                            />
                          </InputGroup>
                          <FieldDescription>
                            A parent such as example.com includes the parent and
                            every subdomain, including portal.example.com.
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel>Saved Live source</FieldLabel>
                          <Select
                            items={liveSourceItems}
                            onValueChange={(value) =>
                              setLiveSourceId(String(value))
                            }
                            value={selectedLiveSource?.id ?? allLiveSourcesId}
                          >
                            <SelectTrigger aria-label="Saved Live source">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {liveSourceItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Button
                          disabled={
                            liveBusy ||
                            !selectedLiveSource ||
                            !isDomainQuery(domainToScan)
                          }
                          onClick={() => {
                            if (
                              selectedLiveSource &&
                              isDomainQuery(domainToScan)
                            ) {
                              liveScan.mutate({
                                domain: domainToScan,
                                source: selectedLiveSource,
                              });
                            }
                          }}
                          size="sm"
                        >
                          {liveBusy ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <FileSearchIcon data-icon="inline-start" />
                          )}
                          {liveCheckpointPending
                            ? "Autosaving..."
                            : liveBusy
                              ? "Scanning & autosaving..."
                              : "Scan & autosave"}
                        </Button>
                        <FieldDescription>
                          Matches are saved locally as they appear. Pausing or
                          cancelling keeps everything found so far.
                        </FieldDescription>
                      </FieldGroup>
                      <LiveSearchPreflight
                        currentWorkerLimit={settings.data?.workerLimit ?? 2}
                        includeArchives={
                          selectedLiveSource?.includeArchives ?? true
                        }
                        source={selectedLiveSource}
                      />
                    </>
                  ) : (
                    <Alert>
                      <ArchiveIcon />
                      <AlertTitle>No saved Live sources</AlertTitle>
                      <AlertDescription>
                        Add a file, folder, or archive before starting a Live
                        domain scan.
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          nativeButton={false}
                          render={<a href="#/datasets" />}
                          size="sm"
                          variant="outline"
                        >
                          Add source
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}
                  {currentLiveProgress ? (
                    <Alert role="status">
                      {liveCheckpointPending ||
                      ["running", "cancelling"].includes(
                        currentLiveProgress.status,
                      ) ? (
                        <Spinner />
                      ) : currentLiveProgress.status === "completed" ? (
                        <CheckCircle2Icon />
                      ) : (
                        <PauseIcon />
                      )}
                      <AlertTitle>
                        {liveCheckpointPending
                          ? "Autosaving Live results"
                          : currentLiveProgress.message}
                      </AlertTitle>
                      <AlertDescription className="flex flex-col gap-3">
                        <Progress value={livePercent}>
                          <ProgressLabel>
                            {formatCount(currentLiveProgress.matches)} matches
                          </ProgressLabel>
                          <ProgressValue>
                            {() => formatProgressPercent(livePercent)}
                          </ProgressValue>
                        </Progress>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {formatBytes(currentLiveProgress.bytesPerSecond)}/s
                          </Badge>
                          <Badge variant="outline">
                            {currentLiveProgress.status === "completed"
                              ? "Done"
                              : currentLiveProgress.status === "paused"
                                ? "Paused"
                                : currentLiveProgress.status === "cancelling"
                                  ? "Stopping"
                                  : `${formatDuration(
                                      currentLiveProgress.estimatedRemainingMs,
                                    )} remaining`}
                          </Badge>
                          <Badge variant="outline">
                            {formatCount(currentLiveProgress.filesScanned)} of{" "}
                            {formatCount(currentLiveProgress.sourceCount)} files
                          </Badge>
                          {displayedSavedLiveHitCount > 0 ? (
                            <Badge variant="secondary">
                              {formatCount(displayedSavedLiveHitCount)} stored
                              locally
                            </Badge>
                          ) : null}
                          {currentLiveProgress.status === "running" ? (
                            <Button
                              className="ms-auto"
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
                          ) : currentLiveProgress.status === "paused" ? (
                            <Button
                              className="ms-auto"
                              disabled={controlPending !== null}
                              onClick={() =>
                                void resumeLiveSearch(currentLiveProgress.jobId)
                              }
                              size="sm"
                              variant="outline"
                            >
                              <PlayIcon data-icon="inline-start" />
                              Continue
                            </Button>
                          ) : null}
                          {["running", "paused", "cancelling"].includes(
                            currentLiveProgress.status,
                          ) ? (
                            <Button
                              className={cn(
                                currentLiveProgress.status === "cancelling" &&
                                  "ms-auto",
                              )}
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
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {displayedLiveNotice ? (
                    <Alert role="status">
                      <CheckCircle2Icon />
                      <AlertTitle>Live scan update</AlertTitle>
                      <AlertDescription>{displayedLiveNotice}</AlertDescription>
                    </Alert>
                  ) : null}
                </FieldSet>
              </>
            ) : null}
            <ScrollArea className="h-[26rem] pe-2">
              {sourceView === "live" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <FileSearchIcon />
                    Saved Live results
                  </div>
                  {(storedCollections.data?.collections ?? []).length ? (
                    (storedCollections.data?.collections ?? []).map(
                      (collection) => (
                        <div
                          className="flex min-w-0 items-center gap-1"
                          key={collection.registrableDomain}
                        >
                          <Button
                            className="h-auto min-w-0 flex-1 justify-between px-3 py-2"
                            onClick={() => {
                              setSelectedDomain(collection.registrableDomain);
                              setLiveDomainInput(collection.registrableDomain);
                              setLiveRecordOffset(0);
                            }}
                            variant={
                              activeDomain === collection.registrableDomain
                                ? "secondary"
                                : "ghost"
                            }
                          >
                            <span className="truncate">
                              {collection.registrableDomain}
                            </span>
                            <Badge variant="outline">
                              {formatCount(collection.evidenceCount)}
                            </Badge>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  aria-label={`Delete saved results for ${collection.registrableDomain}`}
                                  size="icon-sm"
                                  variant="ghost"
                                />
                              }
                            >
                              <Trash2Icon />
                            </AlertDialogTrigger>
                            <AlertDialogContent size="sm">
                              <AlertDialogHeader>
                                <AlertDialogMedia>
                                  <Trash2Icon />
                                </AlertDialogMedia>
                                <AlertDialogTitle>
                                  Delete saved domain results?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This removes{" "}
                                  {formatCount(collection.evidenceCount)} saved
                                  rows for {collection.registrableDomain}.
                                  Original source files are never changed.
                                  Cancel an active scan first or new matches may
                                  be saved again.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  Keep results
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={clearLiveCollection.isPending}
                                  onClick={() =>
                                    clearLiveCollection.mutate(
                                      collection.registrableDomain,
                                    )
                                  }
                                  variant="destructive"
                                >
                                  {clearLiveCollection.isPending ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : (
                                    <Trash2Icon data-icon="inline-start" />
                                  )}
                                  Delete results
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ),
                    )
                  ) : (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No saved Live results yet. Enter a domain above and start
                      a scan.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <DatabaseIcon />
                    Indexed groups
                  </div>
                  {domains.isPending ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                      <Spinner />
                      Loading indexed groups
                    </div>
                  ) : domains.isError ? (
                    <Empty className="min-h-48 rounded-none border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <AlertCircleIcon />
                        </EmptyMedia>
                        <EmptyTitle>Could not load indexed domains</EmptyTitle>
                        <EmptyDescription>
                          {String(domains.error)}
                        </EmptyDescription>
                        <Button
                          onClick={() => void domains.refetch()}
                          size="sm"
                          variant="outline"
                        >
                          Try again
                        </Button>
                      </EmptyHeader>
                    </Empty>
                  ) : (domains.data?.groups ?? []).length ? (
                    (domains.data?.groups ?? []).map((group) => (
                      <Button
                        className="h-auto w-full justify-between px-3 py-2"
                        key={group.registrableDomain}
                        onClick={() => {
                          const reloadActiveDomain =
                            activeDomain === group.registrableDomain;
                          setSelectedDomain(group.registrableDomain);
                          setHostname(null);
                          setRecordOffset(0);
                          if (reloadActiveDomain) void details.refetch();
                        }}
                        variant={
                          activeDomain === group.registrableDomain
                            ? "secondary"
                            : "ghost"
                        }
                      >
                        <span className="truncate">
                          {group.registrableDomain}
                        </span>
                        <Badge variant="outline">
                          {formatCount(group.recordCount)}
                        </Badge>
                      </Button>
                    ))
                  ) : (
                    <Empty className="min-h-48 rounded-none border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <DatabaseIcon />
                        </EmptyMedia>
                        <EmptyTitle>No domains in this scope</EmptyTitle>
                        <EmptyDescription>
                          Change the dataset or build the complete domain
                          catalog from indexed records. No domain is required.
                        </EmptyDescription>
                        <Button
                          disabled={domainRepair.isPending}
                          onClick={() => domainRepair.mutate()}
                          size="sm"
                          variant="outline"
                        >
                          {domainRepair.isPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : null}
                          {domainRepair.isPending
                            ? "Building all domains…"
                            : "Build all domains"}
                        </Button>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
          {sourceView === "live" &&
          storedCollections.data &&
          storedCollections.data.total > 0 ? (
            <PaginationControls
              label="saved Live results"
              limit={pageSize}
              offset={offset}
              onOffsetChange={setOffset}
              total={storedCollections.data.total}
            />
          ) : sourceView === "indexed" &&
            domains.data &&
            domains.data.total > 0 ? (
            <PaginationControls
              label="domain groups"
              limit={pageSize}
              offset={offset}
              onOffsetChange={setOffset}
              total={domains.data.total}
            />
          ) : null}
        </DashboardCard>

        <DashboardCard className="min-h-0 min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>
              {sourceView === "live" && liveScanContext
                ? `${liveScanContext.query ?? "Domain"} · Live scan`
                : (activeDomain ??
                  (sourceView === "live"
                    ? "Live scan results"
                    : "Indexed domain evidence"))}
            </CardTitle>
            <CardDescription>
              {sourceView === "live"
                ? currentLiveProgress
                  ? `${formatCount(currentLiveProgress.matches)} matches found · ${formatCount(currentLiveProgress.hits.length)} displayed now`
                  : activeDomain
                    ? `${formatCount(liveEvidence.data?.total ?? 0)} stored Live lines`
                    : "Results appear here while the scan is running."
                : details.isPending
                  ? "Loading indexed records..."
                  : details.isError
                    ? "Indexed records could not be loaded."
                    : `${formatCount(details.data?.totalRecords ?? 0)} indexed lines · ${selectedIndexedDataset?.name ?? "all datasets"}`}
            </CardDescription>
          </CardHeader>
          {activeDomain || (sourceView === "live" && currentLiveProgress) ? (
            <>
              {sourceView === "indexed" ? (
                <>
                  <CardContent className="flex flex-col gap-4 border-b p-4">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Subdomains
                      </p>
                      <InputGroup>
                        <InputGroupAddon>
                          <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                          aria-label="Filter subdomains"
                          onChange={(event) => {
                            setHostnameQuery(event.target.value);
                            setHostname(null);
                            setRecordOffset(0);
                          }}
                          placeholder="Filter hostnames"
                          value={hostnameQuery}
                        />
                      </InputGroup>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => {
                            setHostname(null);
                            setRecordOffset(0);
                          }}
                          size="sm"
                          variant={hostname === null ? "secondary" : "outline"}
                        >
                          All hosts
                        </Button>
                        {(details.data?.hostnames ?? []).map((item) => (
                          <Button
                            key={item.id}
                            onClick={() => {
                              setHostname(item.hostname);
                              setRecordOffset(0);
                            }}
                            size="sm"
                            variant={
                              hostname === item.hostname
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {item.hostname}
                            <Badge variant="outline">{item.recordCount}</Badge>
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Linked indexed datasets
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(details.data?.breaches ?? []).map((breach) => (
                          <Badge key={breach.datasetId} variant="outline">
                            {breach.datasetName} · {breach.recordCount}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                  <CardContent className="px-0">
                    {details.isPending ? (
                      <Empty className="min-h-64 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <LoaderCircleIcon className="animate-spin" />
                          </EmptyMedia>
                          <EmptyTitle>Loading linked lines</EmptyTitle>
                          <EmptyDescription>
                            Reading the selected domain from the local index.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : details.isError ? (
                      <Empty className="min-h-64 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <AlertCircleIcon />
                          </EmptyMedia>
                          <EmptyTitle>Could not load linked lines</EmptyTitle>
                          <EmptyDescription>
                            {String(details.error)}
                          </EmptyDescription>
                          <Button
                            onClick={() => void details.refetch()}
                            size="sm"
                            variant="outline"
                          >
                            Try again
                          </Button>
                        </EmptyHeader>
                      </Empty>
                    ) : details.data?.records.length ? (
                      <ScrollArea className="h-[min(50vh,34rem)]">
                        <Table className="table-fixed">
                          <TableHeader className="sticky top-0 bg-background">
                            <TableRow>
                              <TableHead className="w-48 ps-6">
                                Location
                              </TableHead>
                              <TableHead className="hidden w-52 lg:table-cell">
                                Dataset
                              </TableHead>
                              <TableHead className="pe-6">Evidence</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {details.data.records.map((record) => (
                              <TableRow key={record.recordId}>
                                <TableCell className="min-w-0 py-3 ps-6 align-top">
                                  <Badge
                                    className="max-w-full font-mono tabular-nums"
                                    title={record.sourceLocation}
                                    variant="outline"
                                  >
                                    {record.sourceLocation}
                                  </Badge>
                                  <p
                                    className="mt-2 truncate text-xs text-muted-foreground"
                                    title={formatPathForDisplay(
                                      record.sourceFile,
                                    )}
                                  >
                                    {formatFileNameForDisplay(
                                      record.sourceFile,
                                    )}
                                  </p>
                                  <div className="mt-1 min-w-0 lg:hidden">
                                    <p
                                      className="truncate text-xs font-medium"
                                      title={record.datasetName}
                                    >
                                      {record.datasetName}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden min-w-0 py-3 align-top lg:table-cell">
                                  <p
                                    className="line-clamp-2 font-medium leading-5"
                                    title={record.datasetName}
                                  >
                                    {record.datasetName}
                                  </p>
                                </TableCell>
                                <TableCell className="min-w-0 whitespace-normal py-3 pe-6 align-top">
                                  <p
                                    className="font-mono text-xs leading-5 break-words [overflow-wrap:anywhere]"
                                    title={record.fields
                                      .map((field) => field.displayValue)
                                      .join(" | ")}
                                  >
                                    {record.fields
                                      .map((field) => field.displayValue)
                                      .join(" | ") || "No displayable values"}
                                  </p>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <Empty className="min-h-64 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Globe2Icon />
                          </EmptyMedia>
                          <EmptyTitle>No indexed lines</EmptyTitle>
                          <EmptyDescription>
                            Adjust the filters or use the stored Live evidence
                            below.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                  {details.data ? (
                    <PaginationControls
                      label="domain evidence"
                      limit={pageSize}
                      offset={recordOffset}
                      onOffsetChange={setRecordOffset}
                      total={details.data.totalRecords}
                    />
                  ) : null}
                </>
              ) : null}
              {sourceView === "live" && currentLiveProgress ? (
                <CardContent className="min-h-[34rem] basis-0 flex-1 overflow-hidden border-b px-0">
                  {currentLiveProgress.hits.length ? (
                    <ScrollArea
                      className="h-full min-h-[34rem]"
                      data-testid="active-live-domain-results"
                    >
                      <Table className="table-fixed">
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            <TableHead className="w-48 ps-6">
                              Source line
                            </TableHead>
                            <TableHead>Matches appearing now</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentLiveProgress.hits.map((hit) => (
                            <TableRow key={hit.id}>
                              <TableCell className="min-w-0 ps-6 align-top">
                                <p
                                  className="truncate text-xs"
                                  title={formatPathForDisplay(hit.sourcePath)}
                                >
                                  {formatFileNameForDisplay(hit.sourceFile)}
                                </p>
                                <p
                                  className="truncate font-mono text-xs text-muted-foreground"
                                  title={hit.sourceLocation}
                                >
                                  {hit.sourceLocation}
                                </p>
                                {hit.archiveEntry ? (
                                  <p
                                    className="truncate font-mono text-[11px] text-muted-foreground"
                                    title={hit.archiveEntry}
                                  >
                                    {hit.archiveEntry}
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell className="min-w-0 whitespace-normal pe-6 align-top">
                                <p className="break-words [overflow-wrap:anywhere]">
                                  {hit.excerpt}
                                </p>
                                <p className="mt-2 truncate text-xs text-muted-foreground">
                                  {hit.matchReason}
                                </p>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  ) : (
                    <Empty className="min-h-64 rounded-none border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          {currentLiveProgress.status === "running" ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : (
                            <FileSearchIcon />
                          )}
                        </EmptyMedia>
                        <EmptyTitle>
                          {currentLiveProgress.status === "paused"
                            ? "Scan paused"
                            : currentLiveProgress.status === "cancelled"
                              ? "Scan cancelled"
                              : "Scanning for matching lines"}
                        </EmptyTitle>
                        <EmptyDescription>
                          Results appear here immediately when matches are
                          found.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              ) : null}
              {sourceView === "live" && activeDomain && !currentLiveProgress ? (
                <>
                  <CardHeader className="border-y">
                    <CardTitle>Stored Live evidence</CardTitle>
                    <CardDescription>
                      Lines gathered from saved files, folders, and archives
                      without building an index.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="min-h-[34rem] basis-0 flex-1 overflow-hidden px-0">
                    {liveEvidence.isPending ? (
                      <Empty className="min-h-48 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <LoaderCircleIcon className="animate-spin" />
                          </EmptyMedia>
                          <EmptyTitle>Loading stored Live lines</EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    ) : liveEvidence.isError ? (
                      <Empty className="min-h-48 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <AlertCircleIcon />
                          </EmptyMedia>
                          <EmptyTitle>
                            Could not load stored Live lines
                          </EmptyTitle>
                          <EmptyDescription>
                            {String(liveEvidence.error)}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : liveEvidence.data?.evidence.length ? (
                      <ScrollArea className="h-full min-h-[34rem]">
                        <Table className="table-fixed">
                          <TableHeader className="sticky top-0 z-10 bg-background">
                            <TableRow>
                              <TableHead className="w-48 ps-6">
                                Source line
                              </TableHead>
                              <TableHead className="hidden w-56 xl:table-cell">
                                Live source
                              </TableHead>
                              <TableHead className="pe-6">
                                Line contents
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {liveEvidence.data.evidence.map((evidence) => (
                              <TableRow key={evidence.id}>
                                <TableCell className="min-w-0 ps-6 align-top">
                                  <p
                                    className="truncate text-xs"
                                    title={formatPathForDisplay(
                                      evidence.sourcePath,
                                    )}
                                  >
                                    {formatFileNameForDisplay(
                                      evidence.sourceFile,
                                    )}
                                  </p>
                                  <p
                                    className="truncate font-mono text-xs text-muted-foreground"
                                    title={evidence.sourceLocation}
                                  >
                                    {evidence.sourceLocation}
                                  </p>
                                  {evidence.archiveEntry ? (
                                    <p
                                      className="truncate font-mono text-[11px] text-muted-foreground"
                                      title={evidence.archiveEntry}
                                    >
                                      {evidence.archiveEntry}
                                    </p>
                                  ) : null}
                                </TableCell>
                                <TableCell className="hidden min-w-0 align-top xl:table-cell">
                                  <p
                                    className="truncate"
                                    title={evidence.sourceName}
                                  >
                                    {evidence.sourceName}
                                  </p>
                                  <p
                                    className="truncate font-mono text-[11px] text-muted-foreground"
                                    title={formatPathForDisplay(
                                      evidence.sourcePath,
                                    )}
                                  >
                                    {formatPathForDisplay(evidence.sourcePath)}
                                  </p>
                                </TableCell>
                                <TableCell className="min-w-0 whitespace-normal pe-6 align-top">
                                  <p className="break-words [overflow-wrap:anywhere]">
                                    {evidence.excerpt}
                                  </p>
                                  <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                                    <Badge
                                      className="max-w-full truncate"
                                      title={evidence.matchedQuery}
                                      variant="outline"
                                    >
                                      {evidence.matchedQuery}
                                    </Badge>
                                    <Badge variant="secondary">
                                      {evidence.matchReason}
                                    </Badge>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <Empty className="min-h-48 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <FileSearchIcon />
                          </EmptyMedia>
                          <EmptyTitle>No stored Live lines</EmptyTitle>
                          <EmptyDescription>
                            Enter this domain in the search box, choose a saved
                            Live source, then select Scan &amp; store.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                  {liveEvidence.data ? (
                    <PaginationControls
                      label="stored Live evidence"
                      limit={pageSize}
                      offset={liveRecordOffset}
                      onOffsetChange={setLiveRecordOffset}
                      total={liveEvidence.data.total}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <Empty className="min-h-96 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe2Icon />
                </EmptyMedia>
                <EmptyTitle>
                  {sourceView === "live"
                    ? "Start a Live domain scan"
                    : "Select an indexed domain"}
                </EmptyTitle>
                <EmptyDescription>
                  {sourceView === "live"
                    ? "Enter a domain and choose a saved Live source. Matching lines will appear here while scanning."
                    : "Choose an indexed group to inspect its linked evidence."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
