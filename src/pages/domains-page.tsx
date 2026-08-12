import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ArchiveIcon,
  DatabaseIcon,
  FileSearchIcon,
  Globe2Icon,
  LoaderCircleIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  getSettings,
  getDomainDetails,
  listDomains,
  listLiveDomainCollections,
  listLiveDomainEvidence,
  listLiveSources,
  rebuildDomains,
  saveLiveDomainEvidence,
  startDirectSearch,
  type LiveSourceSummary,
} from "@/lib/desktop";
import { formatBytes, formatCount } from "@/lib/format";

const pageSize = 25;
const allLiveSourcesId = "all-saved-live-sources";

function isDomainQuery(value: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    value.trim(),
  );
}

export function DomainsPage() {
  const queryClient = useQueryClient();
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
  const [liveScanContext, setLiveScanContext] = useState<{
    jobId: string;
    domain: string;
    source: LiveSourceSummary;
  } | null>(null);
  const [repairNotice, setRepairNotice] = useState("");
  const [liveNotice, setLiveNotice] = useState("");
  const storedLiveJobId = useRef<string | null>(null);
  const {
    begin: beginDirectSearch,
    cancel: cancelLiveSearch,
    controlError,
    controlPending,
    progress: directProgress,
  } = useDirectSearchProgress();

  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
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
    onSuccess: async (count) => {
      setRepairNotice(`${formatCount(count)} domain groups linked`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
        queryClient.invalidateQueries({ queryKey: ["domain-details"] }),
      ]);
    },
    onError: (error) =>
      setRepairNotice(`Domain rebuild failed: ${String(error)}`),
  });

  const domains = useQuery({
    queryKey: ["domains", submittedQuery, offset],
    queryFn: () => listDomains(submittedQuery, offset, pageSize),
  });

  const storedCollections = useQuery({
    queryKey: ["live-domain-collections", submittedQuery],
    queryFn: () => listLiveDomainCollections(submittedQuery, 0, 10),
  });

  const activeDomain =
    selectedDomain ??
    domains.data?.groups[0]?.registrableDomain ??
    storedCollections.data?.collections[0]?.registrableDomain ??
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
    enabled: Boolean(activeDomain),
  });

  const liveEvidence = useQuery({
    queryKey: ["live-domain-evidence", activeDomain, liveRecordOffset],
    queryFn: () =>
      listLiveDomainEvidence(activeDomain ?? "", liveRecordOffset, pageSize),
    enabled: Boolean(activeDomain),
  });

  const storeLiveEvidence = useMutation({
    mutationFn: ({
      domain,
      source,
      evidence,
    }: {
      domain: string;
      source: LiveSourceSummary;
      evidence: NonNullable<typeof directProgress>["hits"];
    }) =>
      saveLiveDomainEvidence({
        domain,
        sourceId: source.id,
        sourceName: source.name,
        evidence,
      }),
    onSuccess: async (summary) => {
      setSelectedDomain(summary.registrableDomain);
      setLiveRecordOffset(0);
      setLiveNotice(
        `${formatCount(summary.evidenceCount)} Live rows stored locally`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["live-domain-collections"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["live-domain-evidence", summary.registrableDomain],
        }),
      ]);
    },
    onError: (error) => setLiveNotice(`Could not store scan: ${String(error)}`),
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
        caseSensitive: false,
        includeArchives: source.includeArchives,
        maxResults: 5_000,
        workerLimit: settings.data?.workerLimit ?? 2,
      }),
    onSuccess: (start, variables) => {
      storedLiveJobId.current = null;
      setLiveNotice("");
      setLiveScanContext({ jobId: start.jobId, ...variables });
      beginDirectSearch(start);
    },
    onError: (error) => setLiveNotice(`Live scan failed: ${String(error)}`),
  });

  const currentLiveProgress =
    liveScanContext?.jobId === directProgress?.jobId ? directProgress : null;
  const livePercent = currentLiveProgress?.totalBytes
    ? Math.min(
        100,
        (currentLiveProgress.sourceBytesScanned /
          currentLiveProgress.totalBytes) *
          100,
      )
    : 0;

  useEffect(() => {
    if (!currentLiveProgress || !liveScanContext) return;
    if (
      currentLiveProgress.status !== "completed" ||
      storedLiveJobId.current === currentLiveProgress.jobId
    ) {
      return;
    }
    storedLiveJobId.current = currentLiveProgress.jobId;
    if (!currentLiveProgress.hits.length) return;
    storeLiveEvidence.mutate({
      domain: liveScanContext.domain,
      source: liveScanContext.source,
      evidence: currentLiveProgress.hits,
    });
  }, [currentLiveProgress, liveScanContext, storeLiveEvidence]);

  const datasetItems = [
    { label: "All linked datasets", value: "all" },
    ...(details.data?.breaches ?? []).map((breach) => ({
      label: `${breach.datasetName} (${breach.recordCount})`,
      value: breach.datasetId,
    })),
  ];
  const domainToScan = query.trim() || activeDomain || "";
  const liveBusy =
    liveScan.isPending ||
    storeLiveEvidence.isPending ||
    ["running", "paused", "cancelling"].includes(
      currentLiveProgress?.status ?? "",
    );
  const displayedLiveNotice =
    liveNotice ||
    controlError ||
    (currentLiveProgress?.status === "failed"
      ? currentLiveProgress.message
      : currentLiveProgress?.status === "completed" &&
          currentLiveProgress.hits.length === 0
        ? "Live scan completed with no matching rows."
        : "");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = query.trim();
      if (value === submittedQuery) return;
      setOffset(0);
      setSelectedDomain(isDomainQuery(value) ? value.toLowerCase() : null);
      setSubmittedQuery(value);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, submittedQuery]);

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
          <Button
            disabled={domainRepair.isPending}
            onClick={() => domainRepair.mutate()}
            size="sm"
            variant="outline"
          >
            {domainRepair.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {domainRepair.isPending ? "Rebuilding links…" : "Rebuild links"}
          </Button>
        }
        description="Find a domain, filter its subdomains, and inspect every linked source line."
        title="Domains"
      />
      {repairNotice ? (
        <p className="mb-3 text-xs text-muted-foreground" role="status">
          {repairNotice}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-px bg-border p-px xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <DashboardCard className="min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>Domain groups</CardTitle>
            <CardDescription>
              {domains.data?.total ?? 0} indexed /{" "}
              {storedCollections.data?.total ?? 0} stored Live
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-3">
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
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search domains"
                  value={query}
                />
                {domains.isFetching || storedCollections.isFetching ? (
                  <InputGroupAddon align="inline-end">
                    <Spinner />
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
            </form>
            <div className="flex flex-col gap-2 border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Scan saved Live sources</p>
                  <p className="text-xs text-muted-foreground">
                    Find up to 5,000 matching lines and keep them in this
                    domain.
                  </p>
                </div>
                <ArchiveIcon className="shrink-0 text-muted-foreground" />
              </div>
              {liveSourceItems.length ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    items={liveSourceItems}
                    onValueChange={(value) => setLiveSourceId(String(value))}
                    value={selectedLiveSource?.id ?? allLiveSourcesId}
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {liveSourceItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={
                      liveBusy ||
                      !selectedLiveSource ||
                      !isDomainQuery(domainToScan)
                    }
                    onClick={() => {
                      if (selectedLiveSource && isDomainQuery(domainToScan)) {
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
                    {storeLiveEvidence.isPending
                      ? "Storing..."
                      : liveBusy
                        ? "Scanning..."
                        : "Scan & store"}
                  </Button>
                </div>
              ) : (
                <Button
                  nativeButton={false}
                  render={<a href="#/datasets" />}
                  size="sm"
                  variant="outline"
                >
                  Add a Live source
                </Button>
              )}
              {currentLiveProgress ? (
                <div className="flex flex-col gap-2">
                  <Progress value={livePercent}>
                    <ProgressLabel>{currentLiveProgress.message}</ProgressLabel>
                    <ProgressValue>
                      {() => `${livePercent.toFixed(0)}%`}
                    </ProgressValue>
                  </Progress>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {formatBytes(currentLiveProgress.bytesPerSecond)}/s
                    </Badge>
                    <Badge variant="outline">
                      {formatCount(currentLiveProgress.matches)} matches
                    </Badge>
                    {["running", "paused", "cancelling"].includes(
                      currentLiveProgress.status,
                    ) ? (
                      <Button
                        className="ms-auto"
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
              ) : null}
              {displayedLiveNotice ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {displayedLiveNotice}
                </p>
              ) : null}
            </div>
            {(storedCollections.data?.collections ?? []).length ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                  <FileSearchIcon />
                  Stored Live scans
                </div>
                {(storedCollections.data?.collections ?? []).map(
                  (collection) => (
                    <Button
                      className="h-auto w-full justify-between px-3 py-2"
                      key={collection.registrableDomain}
                      onClick={() => {
                        setSelectedDomain(collection.registrableDomain);
                        setHostname(null);
                        setDatasetId("all");
                        setRecordOffset(0);
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
                  ),
                )}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                <DatabaseIcon />
                Indexed groups
              </div>
              {(domains.data?.groups ?? []).map((group) => (
                <Button
                  className="h-auto w-full justify-between px-3 py-2"
                  key={group.registrableDomain}
                  onClick={() => {
                    const reloadActiveDomain =
                      activeDomain === group.registrableDomain;
                    setSelectedDomain(group.registrableDomain);
                    setHostname(null);
                    setDatasetId("all");
                    setRecordOffset(0);
                    setLiveRecordOffset(0);
                    if (reloadActiveDomain) void details.refetch();
                  }}
                  variant={
                    activeDomain === group.registrableDomain
                      ? "secondary"
                      : "ghost"
                  }
                >
                  <span className="truncate">{group.registrableDomain}</span>
                  <Badge variant="outline">
                    {formatCount(group.recordCount)}
                  </Badge>
                </Button>
              ))}
            </div>
          </CardContent>
          {domains.data ? (
            <PaginationControls
              label="domain groups"
              limit={pageSize}
              offset={offset}
              onOffsetChange={setOffset}
              total={domains.data.total}
            />
          ) : null}
        </DashboardCard>

        <DashboardCard className="min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>{activeDomain ?? "Domain evidence"}</CardTitle>
            <CardDescription>
              {details.isPending || liveEvidence.isPending
                ? "Loading linked records..."
                : details.isError && liveEvidence.isError
                  ? "Linked records could not be loaded."
                  : `${(details.data?.totalRecords ?? 0).toLocaleString()} indexed / ${(liveEvidence.data?.total ?? 0).toLocaleString()} stored Live`}
            </CardDescription>
          </CardHeader>
          {activeDomain ? (
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
                          hostname === item.hostname ? "secondary" : "outline"
                        }
                      >
                        {item.hostname}
                        <Badge variant="outline">{item.recordCount}</Badge>
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {(details.data?.breaches ?? []).map((breach) => (
                      <Badge key={breach.datasetId} variant="outline">
                        {breach.datasetName} · {breach.recordCount}
                      </Badge>
                    ))}
                  </div>
                  <Select
                    items={datasetItems}
                    onValueChange={(value) => {
                      setDatasetId(String(value));
                      setRecordOffset(0);
                    }}
                    value={datasetId}
                  >
                    <SelectTrigger>
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
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-48 ps-6">Source line</TableHead>
                        <TableHead className="hidden w-44 2xl:table-cell">
                          Dataset
                        </TableHead>
                        <TableHead>Line contents</TableHead>
                        <TableHead className="hidden w-44 pe-6 2xl:table-cell">
                          Parser
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.data.records.map((record) => (
                        <TableRow key={record.recordId}>
                          <TableCell className="min-w-0 ps-6">
                            <p className="truncate text-xs">
                              {record.sourceFile}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {record.sourceLocation}
                            </p>
                            <div className="mt-1 min-w-0 2xl:hidden">
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={record.datasetName}
                              >
                                {record.datasetName}
                              </p>
                              <p
                                className="truncate font-mono text-[11px] text-muted-foreground"
                                title={record.parser}
                              >
                                {record.parser}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="hidden min-w-0 2xl:table-cell">
                            <p className="truncate" title={record.datasetName}>
                              {record.datasetName}
                            </p>
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal">
                            <div className="flex min-w-0 max-w-full flex-wrap gap-1">
                              {record.fields.map((field) => (
                                <Badge
                                  className="h-auto max-w-full min-w-0 whitespace-normal py-1 text-left leading-snug [overflow-wrap:anywhere]"
                                  key={`${record.recordId}-${field.name}`}
                                  title={`${field.name}: ${field.displayValue}`}
                                  variant={
                                    field.sensitive ? "secondary" : "outline"
                                  }
                                >
                                  {field.name}: {field.displayValue}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="hidden min-w-0 pe-6 font-mono text-xs text-muted-foreground 2xl:table-cell">
                            <p className="truncate" title={record.parser}>
                              {record.parser}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
              <CardHeader className="border-y">
                <CardTitle>Stored Live evidence</CardTitle>
                <CardDescription>
                  Lines gathered from saved files, folders, and archives without
                  building an index.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
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
                      <EmptyTitle>Could not load stored Live lines</EmptyTitle>
                      <EmptyDescription>
                        {String(liveEvidence.error)}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : liveEvidence.data?.evidence.length ? (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-48 ps-6">Source line</TableHead>
                        <TableHead className="hidden w-56 xl:table-cell">
                          Live source
                        </TableHead>
                        <TableHead className="pe-6">Line contents</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {liveEvidence.data.evidence.map((evidence) => (
                        <TableRow key={evidence.id}>
                          <TableCell className="min-w-0 ps-6 align-top">
                            <p
                              className="truncate text-xs"
                              title={evidence.sourceFile}
                            >
                              {evidence.sourceFile}
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
                            <p className="truncate" title={evidence.sourceName}>
                              {evidence.sourceName}
                            </p>
                            <p
                              className="truncate font-mono text-[11px] text-muted-foreground"
                              title={evidence.sourcePath}
                            >
                              {evidence.sourcePath}
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
                ) : (
                  <Empty className="min-h-48 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FileSearchIcon />
                      </EmptyMedia>
                      <EmptyTitle>No stored Live lines</EmptyTitle>
                      <EmptyDescription>
                        Enter this domain in the search box, choose a saved Live
                        source, then select Scan &amp; store.
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
          ) : (
            <Empty className="min-h-96 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe2Icon />
                </EmptyMedia>
                <EmptyTitle>Select a domain</EmptyTitle>
                <EmptyDescription>Linked evidence loads here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
