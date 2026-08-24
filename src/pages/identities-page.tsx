import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  CheckIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FingerprintIcon,
  FileSearchIcon,
  FolderOpenIcon,
  InfoIcon,
  LinkIcon,
  ListChecksIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareIcon,
  UserRoundCheckIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { LiveSearchPreflight } from "@/components/live-search-preflight";
import {
  ListRowsSkeleton,
  TableRowsSkeleton,
} from "@/components/loading-skeletons";
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
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDirectSearchProgress } from "@/hooks/use-direct-search-progress";
import {
  applyIdentityAction,
  createManualIdentity,
  getSettings,
  listDatasets,
  listIdentities,
  listIdentityMembers,
  listLiveSources,
  recordLiveSearchActivity,
  rebuildIdentities,
  searchIdentityRecords,
  startDirectSearch,
  type IdentitySummary,
  type LiveSourceSummary,
  type SearchMode,
} from "@/lib/desktop";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatFileNameForDisplay,
  formatPathForDisplay,
  formatProgressPercent,
} from "@/lib/format";

const memberLimit = 25;
const identitySearchModes: Array<{ label: string; value: SearchMode }> = [
  { label: "Contains", value: "contains" },
  { label: "Exact", value: "exact" },
  { label: "Prefix", value: "prefix" },
];

export function IdentitiesPage() {
  const queryClient = useQueryClient();
  const automaticRebuildStarted = useRef(false);
  const liveSearchSource = useRef<LiveSourceSummary | null>(null);
  const recordedLiveJobId = useRef<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [createdIdentityId, setCreatedIdentityId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState("groups");
  const [identityFilter, setIdentityFilter] = useState("");
  const [memberOffset, setMemberOffset] = useState(0);
  const [manualQuery, setManualQuery] = useState("");
  const [submittedManualQuery, setSubmittedManualQuery] = useState("");
  const [manualDatasetId, setManualDatasetId] = useState("all");
  const [manualOffset, setManualOffset] = useState(0);
  const [manualName, setManualName] = useState("");
  const [manualSelection, setManualSelection] = useState<Set<string>>(
    new Set(),
  );
  const [evidenceSurface, setEvidenceSurface] = useState<"index" | "live">(
    "index",
  );
  const [selectedLiveSourceId, setSelectedLiveSourceId] = useState("");
  const [liveQuery, setLiveQuery] = useState("");
  const [liveMode, setLiveMode] = useState<SearchMode>("contains");
  const [liveOffset, setLiveOffset] = useState(0);
  const [liveSelection, setLiveSelection] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState<{
    error: boolean;
    title: string;
    description: string;
  } | null>(null);
  const {
    begin: beginLiveSearch,
    cancel: cancelLiveSearch,
    clear: clearLiveSearch,
    controlError,
    controlPending,
    pause: pauseLiveSearch,
    progress: globalLiveProgress,
    resume: resumeLiveSearch,
    session: directSession,
  } = useDirectSearchProgress();

  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: listIdentities,
  });
  const liveSources = useQuery({
    queryKey: ["live-sources"],
    queryFn: listLiveSources,
  });
  const liveSourceList = useMemo(
    () => liveSources.data ?? [],
    [liveSources.data],
  );
  const indexedDatasetList = useMemo(
    () => (datasets.data ?? []).filter((dataset) => dataset.recordCount > 0),
    [datasets.data],
  );
  const activeManualDatasetId = indexedDatasetList.some(
    (dataset) => dataset.id === manualDatasetId,
  )
    ? manualDatasetId
    : "all";
  const manualDatasetOptions = useMemo(
    () => [
      {
        label: `All indexed datasets (${indexedDatasetList.length})`,
        value: "all",
      },
      ...indexedDatasetList.map((dataset) => ({
        label: `${dataset.name} · ${formatCount(dataset.recordCount)} records`,
        value: dataset.id,
      })),
    ],
    [indexedDatasetList],
  );
  const selectedManualDataset = indexedDatasetList.find(
    (dataset) => dataset.id === activeManualDatasetId,
  );
  const activeLiveSourceId = liveSourceList.some(
    (source) => source.id === selectedLiveSourceId,
  )
    ? selectedLiveSourceId
    : (liveSourceList[0]?.id ?? "");
  const selectedLiveSource =
    liveSourceList.find((source) => source.id === activeLiveSourceId) ?? null;
  const liveSourceOptions = useMemo(
    () =>
      liveSourceList.map((source) => ({
        label: source.name,
        value: source.id,
      })),
    [liveSourceList],
  );
  const identityList = useMemo(() => identities.data ?? [], [identities.data]);
  const filteredIdentities = useMemo(() => {
    const needle = identityFilter.trim().toLowerCase();
    if (!needle) return identityList;
    return identityList.filter((identity) =>
      [
        identity.displayLabel,
        identity.linkType,
        identity.userStatus,
        identity.confidenceLevel,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [identityFilter, identityList]);
  const activeIdentity = selectedIdentity ?? identityList[0]?.id ?? null;

  const members = useQuery({
    queryKey: ["identity-members", activeIdentity, memberOffset],
    queryFn: () =>
      listIdentityMembers(
        activeIdentity ?? "",
        memberOffset,
        memberLimit,
        true,
      ),
    enabled: Boolean(activeIdentity),
  });

  const manualResults = useQuery({
    queryKey: [
      "identity-builder-search",
      submittedManualQuery,
      activeManualDatasetId,
      manualOffset,
    ],
    queryFn: () =>
      searchIdentityRecords({
        query: submittedManualQuery,
        mode: "contains",
        datasetId:
          activeManualDatasetId === "all" ? null : activeManualDatasetId,
        fieldType: null,
        offset: manualOffset,
        limit: memberLimit,
      }),
    enabled: Boolean(submittedManualQuery && indexedDatasetList.length),
  });

  const rebuild = useMutation({
    mutationFn: rebuildIdentities,
    onSuccess: async (count) => {
      setNotice(
        `Automatic groups refreshed · ${formatCount(count)} groups found`,
      );
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
    onError: (error) =>
      setNotice(`Automatic grouping failed: ${String(error)}`),
  });
  const liveSearch = useMutation({
    mutationFn: (source: LiveSourceSummary) =>
      startDirectSearch({
        paths: source.paths,
        query: liveQuery.trim(),
        mode: liveMode,
        caseSensitive: false,
        includeArchives: source.includeArchives,
        maxResults: 2_000,
        workerLimit: settings.data?.workerLimit ?? 2,
        sessionContext: {
          scope: "identities",
          sourceId: source.id,
          sourceName: source.name,
        },
      }),
    onSuccess: (start, source) => {
      liveSearchSource.current = source;
      beginLiveSearch(start, {
        scope: "identities",
        query: liveQuery.trim(),
        sourceId: source.id,
        sourceName: source.name,
      });
    },
    onError: (error) => setNotice(`Live scan failed: ${String(error)}`),
  });
  const liveProgress =
    directSession?.scope === "identities" ? globalLiveProgress : null;
  useEffect(() => {
    if (directSession?.scope !== "identities") return;
    const timer = window.setTimeout(() => {
      if (directSession.sourceId) {
        setSelectedLiveSourceId(directSession.sourceId);
      }
      if (directSession.query) setLiveQuery(directSession.query);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [directSession]);
  const clearOwnLiveSearch = () => {
    if (directSession?.scope === "identities") clearLiveSearch();
  };
  const liveHitsById = useMemo(
    () => new Map((liveProgress?.hits ?? []).map((hit) => [hit.id, hit])),
    [liveProgress?.hits],
  );
  const create = useMutation({
    mutationFn: () =>
      createManualIdentity({
        name: manualName.trim(),
        recordIds: [...manualSelection],
        liveEvidence: [...liveSelection]
          .map((id) => liveHitsById.get(id))
          .filter((hit) => hit !== undefined)
          .map((hit) => ({
            sourcePath: hit.sourcePath,
            sourceFile: hit.sourceFile,
            archiveEntry: hit.archiveEntry,
            sourceLocation: hit.sourceLocation,
            excerpt: hit.excerpt,
            matchReason: hit.matchReason,
          })),
      }),
    onSuccess: (id) => {
      const displayLabel = manualName.trim();
      const memberCount = selectedEvidenceCount;
      const hasIndexedEvidence = manualSelection.size > 0;
      const hasLiveEvidence = liveSelection.size > 0;
      queryClient.setQueryData<IdentitySummary[]>(["identities"], (current) => [
        {
          id,
          displayLabel,
          confidenceLevel: "user-confirmed",
          memberCount,
          linkType: hasLiveEvidence
            ? hasIndexedEvidence
              ? "mixed_evidence_bundle"
              : "live_scan_bundle"
            : "manual_bundle",
          explanation: hasLiveEvidence
            ? hasIndexedEvidence
              ? "reviewed_index_and_live_evidence"
              : "reviewed_live_scan_evidence"
            : "manual_search_bundle",
          userStatus: "confirmed",
        },
        ...(current ?? []).filter((identity) => identity.id !== id),
      ]);
      setNotice("Manual identity created");
      setManualName("");
      setManualSelection(new Set());
      setLiveSelection(new Set());
      setSelectedIdentity(id);
      setCreatedIdentityId(id);
      setMemberOffset(0);
      setActiveTab("groups");
      void queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
    onError: (error) => setNotice(`Identity creation failed: ${String(error)}`),
  });
  const review = useMutation({
    mutationFn: ({
      action,
      groupId,
    }: {
      action: "confirm" | "reject";
      groupId: string;
      memberCount: number;
    }) =>
      applyIdentityAction({
        action,
        groupId,
        recordIds: [],
        targetGroupId: null,
      }),
    onMutate: () => setReviewFeedback(null),
    onSuccess: async (_, { action, groupId, memberCount }) => {
      const nextStatus = action === "confirm" ? "confirmed" : "rejected";
      queryClient.setQueryData<IdentitySummary[]>(["identities"], (current) =>
        current?.map((identity) =>
          identity.id === groupId
            ? { ...identity, userStatus: nextStatus }
            : identity,
        ),
      );
      setReviewFeedback({
        error: false,
        title:
          action === "confirm" ? "Identity confirmed" : "Identity rejected",
        description: `${formatCount(memberCount)} linked evidence rows were marked ${nextStatus}.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
        queryClient.invalidateQueries({
          queryKey: ["identity-members", groupId],
        }),
      ]);
    },
    onError: (error) =>
      setReviewFeedback({
        error: true,
        title: "Review was not saved",
        description: String(error),
      }),
  });

  const rebuildGroups = rebuild.mutate;
  useEffect(() => {
    const source = liveSearchSource.current;
    if (
      liveProgress?.status !== "completed" ||
      liveProgress.jobId === recordedLiveJobId.current ||
      !source
    ) {
      return;
    }
    recordedLiveJobId.current = liveProgress.jobId;
    void recordLiveSearchActivity({
      jobId: liveProgress.jobId,
      sourceId: source.id,
      sourceName: source.name,
      matches: liveProgress.matches,
      filesScanned: liveProgress.filesScanned,
      bytesScanned: liveProgress.sourceBytesScanned,
      completedAt: new Date().toISOString(),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["overview"] }))
      .catch(() => undefined);
  }, [liveProgress, queryClient]);

  useEffect(() => {
    if (
      !identities.isSuccess ||
      identityList.length > 0 ||
      automaticRebuildStarted.current
    ) {
      return;
    }
    automaticRebuildStarted.current = true;
    rebuildGroups();
  }, [identities.isSuccess, identityList.length, rebuildGroups]);

  const selectedSummary = identityList.find(
    (item) => item.id === activeIdentity,
  );
  const totalMembers = identityList.reduce(
    (total, identity) => total + identity.memberCount,
    0,
  );
  const confirmedCount = identityList.filter(
    (identity) => identity.userStatus === "confirmed",
  ).length;
  const reviewCount = identityList.filter(
    (identity) => identity.userStatus !== "confirmed",
  ).length;
  const selectedEvidenceCount = manualSelection.size + liveSelection.size;
  const livePercent = liveProgress?.totalBytes
    ? Math.min(
        100,
        (liveProgress.sourceBytesScanned / liveProgress.totalBytes) * 100,
      )
    : 0;
  const visibleLiveHits = (liveProgress?.hits ?? []).slice(
    liveOffset,
    liveOffset + memberLimit,
  );
  const identityStats: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
  }> = [
    {
      label: "Identity groups",
      value: formatCount(identityList.length),
      icon: FingerprintIcon,
    },
    {
      label: "Evidence rows",
      value: formatCount(totalMembers),
      icon: LinkIcon,
    },
    {
      label: "Confirmed",
      value: formatCount(confirmedCount),
      icon: UserRoundCheckIcon,
    },
    {
      label: "Needs review",
      value: formatCount(reviewCount),
      icon: ListChecksIcon,
    },
  ];

  function applyAction(action: "confirm" | "reject") {
    if (!selectedSummary) return;
    review.mutate({
      action,
      groupId: selectedSummary.id,
      memberCount: selectedSummary.memberCount,
    });
  }

  return (
    <div>
      <PageHeader
        actions={
          <Tooltip>
            <TooltipTrigger
              delay={400}
              render={
                <Button
                  disabled={rebuild.isPending}
                  onClick={() => rebuild.mutate()}
                  size="sm"
                  variant="outline"
                >
                  {rebuild.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCwIcon data-icon="inline-start" />
                  )}
                  {rebuild.isPending
                    ? "Finding matches…"
                    : "Refresh automatic groups"}
                </Button>
              }
            />
            <TooltipContent side="bottom">
              Rechecks indexed records for repeated emails, phone numbers, and
              account IDs. Manual identities and Live evidence stay unchanged.
            </TooltipContent>
          </Tooltip>
        }
        description="Review records linked by repeated identifiers, or build a verified identity yourself."
        title="Identities"
      />

      {notice ? (
        <Alert
          className="mb-4"
          role="status"
          variant={
            notice.toLowerCase().includes("failed") ? "destructive" : "default"
          }
        >
          {notice.toLowerCase().includes("failed") ? (
            <AlertCircleIcon />
          ) : (
            <CheckCircle2Icon />
          )}
          <AlertTitle>Identity update</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList variant="line">
          <TabsTrigger value="groups">Identity groups</TabsTrigger>
          <TabsTrigger value="builder">Build identity</TabsTrigger>
        </TabsList>

        <TabsContent value="groups">
          <Alert className="mb-4">
            <InfoIcon />
            <AlertTitle>How automatic groups work</AlertTitle>
            <AlertDescription>
              Aletheia creates a group when the same email, phone number, or
              account ID appears in at least two indexed records. Refresh after
              adding or changing an index.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-px bg-border p-px lg:grid-cols-4">
            {identityStats.map(({ icon: Icon, label, value }) => (
              <DashboardCard key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {identities.isPending ? (
                      <Skeleton className="h-8 w-16" />
                    ) : (
                      value
                    )}
                  </CardTitle>
                  <CardAction>
                    <Icon />
                  </CardAction>
                </CardHeader>
              </DashboardCard>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-[19rem_1fr]">
            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Identity groups</CardTitle>
                <CardDescription>
                  {formatCount(filteredIdentities.length)} visible groups
                </CardDescription>
              </CardHeader>
              <CardContent className="border-b p-3">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Filter identities"
                    onChange={(event) => setIdentityFilter(event.target.value)}
                    placeholder="Filter groups"
                    value={identityFilter}
                  />
                </InputGroup>
              </CardContent>
              <CardContent className="px-0">
                {identities.isPending ? (
                  <ListRowsSkeleton rows={8} />
                ) : filteredIdentities.length ? (
                  <ScrollArea className="h-[31rem]">
                    <div className="flex flex-col">
                      {filteredIdentities.map((identity) => (
                        <Button
                          className={`h-auto w-full justify-start rounded-none px-4 py-3 ${
                            identity.id === createdIdentityId
                              ? "identity-created"
                              : ""
                          }`}
                          key={identity.id}
                          onAnimationEnd={() => {
                            if (identity.id === createdIdentityId) {
                              setCreatedIdentityId(null);
                            }
                          }}
                          onClick={() => {
                            setSelectedIdentity(identity.id);
                            setMemberOffset(0);
                            setReviewFeedback(null);
                          }}
                          variant={
                            identity.id === activeIdentity
                              ? "secondary"
                              : "ghost"
                          }
                        >
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate font-medium">
                              {identity.displayLabel}
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {identity.linkType.replaceAll("_", " ")} ·{" "}
                              {formatCount(identity.memberCount)} evidence rows
                            </span>
                          </span>
                          <Badge variant="outline">{identity.userStatus}</Badge>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <Empty className="min-h-72 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FingerprintIcon />
                      </EmptyMedia>
                      <EmptyTitle>No matching groups</EmptyTitle>
                      <EmptyDescription>
                        Refresh automatic groups or change the filter.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </DashboardCard>

            {identities.isPending ? (
              <DashboardCard className="gap-0">
                <TableRowsSkeleton className="min-h-[31rem]" rows={7} />
              </DashboardCard>
            ) : selectedSummary ? (
              <DashboardCard className="gap-0">
                <CardHeader className="border-b">
                  <CardTitle>{selectedSummary.displayLabel}</CardTitle>
                  <CardDescription>
                    {selectedSummary.explanation.replaceAll("_", " ")}
                  </CardDescription>
                  <CardAction>
                    <div className="flex gap-2">
                      <Badge variant="outline">
                        {selectedSummary.confidenceLevel}
                      </Badge>
                      <Badge
                        variant={
                          selectedSummary.userStatus === "confirmed"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {selectedSummary.userStatus}
                      </Badge>
                    </div>
                  </CardAction>
                </CardHeader>
                {reviewFeedback ? (
                  <CardContent className="border-b p-4">
                    <Alert
                      role="status"
                      variant={reviewFeedback.error ? "destructive" : "default"}
                    >
                      {reviewFeedback.error ? (
                        <AlertCircleIcon />
                      ) : (
                        <CheckCircle2Icon />
                      )}
                      <AlertTitle>{reviewFeedback.title}</AlertTitle>
                      <AlertDescription>
                        {reviewFeedback.description}
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                ) : null}
                <CardContent className="grid grid-cols-3 gap-px bg-border p-px">
                  {[
                    [
                      "Linked evidence",
                      formatCount(
                        members.data?.total ?? selectedSummary.memberCount,
                      ),
                    ],
                    [
                      "Link type",
                      selectedSummary.linkType.replaceAll("_", " "),
                    ],
                    ["Review state", selectedSummary.userStatus],
                  ].map(([label, value]) => (
                    <div className="bg-background p-4" key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 truncate font-mono text-sm">{value}</p>
                    </div>
                  ))}
                </CardContent>
                <CardContent className="px-0">
                  {members.isPending ? (
                    <TableRowsSkeleton className="min-h-72" rows={6} />
                  ) : (
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-3/5 ps-6">
                            Record values
                          </TableHead>
                          <TableHead className="pe-6">Context</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(members.data?.members ?? []).map((member) => {
                          const values = member.fields
                            .filter(
                              (field) =>
                                !["password", "password_hash", "salt"].includes(
                                  field.fieldType,
                                ),
                            )
                            .map((field) => field.displayValue);
                          return (
                            <TableRow key={member.recordId}>
                              <TableCell className="whitespace-normal ps-6">
                                <p className="font-mono text-xs break-all">
                                  {values.join(" | ") ||
                                    "No displayable values"}
                                </p>
                              </TableCell>
                              <TableCell className="whitespace-normal pe-6">
                                <p className="truncate text-xs font-medium">
                                  {member.datasetName}
                                </p>
                                <p
                                  className="truncate text-xs text-muted-foreground"
                                  title={formatPathForDisplay(
                                    member.sourcePath ?? member.sourceFile,
                                  )}
                                >
                                  {formatFileNameForDisplay(member.sourceFile)}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {member.sourceLocation}
                                  </span>
                                  <Badge variant="outline">
                                    {member.userStatus}
                                  </Badge>
                                  {member.origin === "live" ? (
                                    <Badge variant="secondary">
                                      Full safe row
                                    </Badge>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
                {members.data ? (
                  <PaginationControls
                    label="identity members"
                    limit={memberLimit}
                    offset={memberOffset}
                    onOffsetChange={setMemberOffset}
                    total={members.data.total}
                  />
                ) : null}
                <CardFooter className="justify-between gap-2 rounded-none bg-background">
                  <p className="text-xs text-muted-foreground">
                    Confirm only after reviewing linked source rows.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={
                        review.isPending ||
                        selectedSummary.userStatus === "rejected"
                      }
                      onClick={() => applyAction("reject")}
                      size="sm"
                      variant="outline"
                    >
                      {review.isPending &&
                      review.variables?.action === "reject" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <XIcon data-icon="inline-start" />
                      )}
                      {review.isPending && review.variables?.action === "reject"
                        ? "Rejecting…"
                        : selectedSummary.userStatus === "rejected"
                          ? "Rejected"
                          : "Reject"}
                    </Button>
                    <Button
                      disabled={
                        review.isPending ||
                        selectedSummary.userStatus === "confirmed"
                      }
                      onClick={() => applyAction("confirm")}
                      size="sm"
                    >
                      {review.isPending &&
                      review.variables?.action === "confirm" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <CheckIcon data-icon="inline-start" />
                      )}
                      {review.isPending &&
                      review.variables?.action === "confirm"
                        ? "Confirming…"
                        : selectedSummary.userStatus === "confirmed"
                          ? "Confirmed"
                          : "Confirm"}
                    </Button>
                  </div>
                </CardFooter>
              </DashboardCard>
            ) : (
              <DashboardCard>
                <Empty className="min-h-[31rem] rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FingerprintIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {rebuild.isPending
                        ? "Analyzing identifiers"
                        : "No repeated identities yet"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {rebuild.isPending
                        ? "Emails and phone numbers are being grouped in the background. You can keep using the app."
                        : "Automatic identities require the same email, phone number, or service ID in at least two records."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </DashboardCard>
            )}
          </div>
        </TabsContent>

        <TabsContent value="builder">
          <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-[1fr_20rem]">
            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Find evidence</CardTitle>
                <CardDescription>
                  Use the persistent index or scan large local sources directly.
                </CardDescription>
                <CardAction>
                  {manualResults.isFetching ||
                  ["running", "paused", "cancelling"].includes(
                    liveProgress?.status ?? "",
                  ) ? (
                    <Badge>
                      {liveProgress?.status === "running" ? <Spinner /> : null}
                      {evidenceSurface === "live"
                        ? liveProgress?.status === "paused"
                          ? "Scan paused"
                          : liveProgress?.status === "cancelling"
                            ? "Cancelling scan"
                            : "Scanning files"
                        : "Searching index"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {formatCount(selectedEvidenceCount)} selected
                    </Badge>
                  )}
                </CardAction>
              </CardHeader>
              <Tabs
                onValueChange={(value) =>
                  setEvidenceSurface(value as "index" | "live")
                }
                value={evidenceSurface}
              >
                <TabsList className="m-4" variant="line">
                  <TabsTrigger value="index">
                    <DatabaseIcon />
                    Indexed evidence
                  </TabsTrigger>
                  <TabsTrigger value="live">
                    <FileSearchIcon />
                    Live files & archives
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="index">
                  <CardContent className="border-b p-4">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!manualQuery.trim() || !indexedDatasetList.length)
                          return;
                        setManualOffset(0);
                        setSubmittedManualQuery(manualQuery.trim());
                      }}
                    >
                      <FieldGroup>
                        <Field>
                          <FieldLabel>1. Choose an indexed dataset</FieldLabel>
                          <div className="flex min-w-0 items-center gap-2">
                            <Select
                              disabled={!indexedDatasetList.length}
                              items={manualDatasetOptions}
                              onValueChange={(value) => {
                                setManualDatasetId(String(value));
                                setManualOffset(0);
                                setSubmittedManualQuery("");
                              }}
                              value={activeManualDatasetId}
                            >
                              <SelectTrigger
                                aria-label="Identity indexed dataset"
                                className="min-w-0 flex-1"
                              >
                                <SelectValue placeholder="Choose an indexed dataset" />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectGroup>
                                  {manualDatasetOptions.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      <DatabaseIcon />
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <Button
                              nativeButton={false}
                              render={<a href="#/datasets" />}
                              size="sm"
                              variant="outline"
                            >
                              <FolderOpenIcon data-icon="inline-start" />
                              Manage
                            </Button>
                          </div>
                          <FieldDescription>
                            {selectedManualDataset
                              ? `${formatCount(selectedManualDataset.recordCount)} searchable records in ${selectedManualDataset.name}.`
                              : indexedDatasetList.length
                                ? `Search across all ${formatCount(indexedDatasetList.length)} persistent indexes.`
                                : "Index a dataset before building an identity from indexed evidence."}
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="identity-evidence-query">
                            2. Search this dataset
                          </FieldLabel>
                          <InputGroup>
                            <InputGroupAddon>
                              <SearchIcon />
                            </InputGroupAddon>
                            <InputGroupInput
                              aria-label="Find identity evidence"
                              disabled={!indexedDatasetList.length}
                              id="identity-evidence-query"
                              onChange={(event) =>
                                setManualQuery(event.target.value)
                              }
                              placeholder="Name, email, username, phone, or account ID"
                              value={manualQuery}
                            />
                            <InputGroupAddon align="inline-end">
                              <Button
                                disabled={
                                  !manualQuery.trim() ||
                                  !indexedDatasetList.length ||
                                  manualResults.isFetching
                                }
                                size="sm"
                                type="submit"
                              >
                                {manualResults.isFetching ? (
                                  <Spinner data-icon="inline-start" />
                                ) : null}
                                {manualResults.isFetching
                                  ? "Searching…"
                                  : "Search"}
                              </Button>
                            </InputGroupAddon>
                          </InputGroup>
                        </Field>
                      </FieldGroup>
                    </form>
                  </CardContent>
                  <CardContent className="px-0">
                    {manualResults.isFetching &&
                    !manualResults.data?.hits.length ? (
                      <TableRowsSkeleton className="min-h-80" rows={5} />
                    ) : manualResults.data?.hits.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 ps-4" />
                            <TableHead>Evidence</TableHead>
                            <TableHead className="pe-6">Context</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {manualResults.data.hits.map((hit) => (
                            <TableRow key={hit.recordId}>
                              <TableCell className="ps-4">
                                <Checkbox
                                  aria-label={`Select ${hit.recordId}`}
                                  checked={manualSelection.has(hit.recordId)}
                                  onCheckedChange={(checked) =>
                                    setManualSelection((current) => {
                                      const next = new Set(current);
                                      if (checked) next.add(hit.recordId);
                                      else next.delete(hit.recordId);
                                      return next;
                                    })
                                  }
                                />
                              </TableCell>
                              <TableCell className="max-w-2xl">
                                <p className="font-mono text-xs break-all">
                                  {hit.fields
                                    .filter(
                                      (field) =>
                                        ![
                                          "password",
                                          "password_hash",
                                          "salt",
                                        ].includes(field.fieldType),
                                    )
                                    .slice(0, 8)
                                    .map((field) => field.displayValue)
                                    .join(" | ") || "No displayable values"}
                                </p>
                              </TableCell>
                              <TableCell className="whitespace-normal pe-6">
                                <p className="truncate text-xs font-medium">
                                  {hit.datasetName}
                                </p>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {hit.sourceLocation}
                                </p>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Empty className="min-h-80 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <SearchIcon />
                          </EmptyMedia>
                          <EmptyTitle>Find a person or account</EmptyTitle>
                          <EmptyDescription>
                            Search, review the matching rows, then select the
                            evidence to bundle.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                  {manualResults.data ? (
                    <PaginationControls
                      label="identity builder results"
                      limit={memberLimit}
                      offset={manualOffset}
                      onOffsetChange={setManualOffset}
                      total={manualResults.data.total}
                    />
                  ) : null}
                </TabsContent>

                <TabsContent value="live">
                  <CardContent className="border-y p-4">
                    <div className="flex flex-col gap-4">
                      <FieldGroup>
                        <Field>
                          <FieldLabel>1. Choose a saved Live source</FieldLabel>
                          <FieldDescription>
                            Reuse any folder or archive source saved on the
                            Datasets page. Original files stay read-only.
                          </FieldDescription>
                          {liveSourceList.length ? (
                            <div className="flex min-w-0 items-center gap-2">
                              <Select
                                items={liveSourceOptions}
                                onValueChange={(value) => {
                                  setSelectedLiveSourceId(value as string);
                                  setLiveOffset(0);
                                  setLiveSelection(new Set());
                                  clearOwnLiveSearch();
                                }}
                                value={activeLiveSourceId}
                              >
                                <SelectTrigger
                                  aria-label="Identity Live source"
                                  className="min-w-0 flex-1"
                                >
                                  <SelectValue placeholder="Select a saved source" />
                                </SelectTrigger>
                                <SelectContent alignItemWithTrigger={false}>
                                  <SelectGroup>
                                    {liveSourceList.map((source) => (
                                      <SelectItem
                                        key={source.id}
                                        value={source.id}
                                      >
                                        {source.name} ·{" "}
                                        {formatCount(source.paths.length)}{" "}
                                        {source.paths.length === 1
                                          ? "location"
                                          : "locations"}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <Button
                                nativeButton={false}
                                render={<a href="#/datasets" />}
                                size="sm"
                                variant="outline"
                              >
                                <FolderOpenIcon data-icon="inline-start" />
                                Manage
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3 border border-dashed p-3">
                              <p className="text-sm text-muted-foreground">
                                No saved Live sources yet.
                              </p>
                              <Button
                                nativeButton={false}
                                render={<a href="#/datasets" />}
                                size="sm"
                                variant="outline"
                              >
                                <FolderOpenIcon data-icon="inline-start" />
                                Add source
                              </Button>
                            </div>
                          )}
                          {selectedLiveSource ? (
                            <p
                              className="truncate font-mono text-xs text-muted-foreground"
                              title={selectedLiveSource.paths
                                .map(formatPathForDisplay)
                                .join("\n")}
                            >
                              {formatPathForDisplay(
                                selectedLiveSource.paths[0] ?? "",
                              )}
                              {selectedLiveSource.paths.length > 1
                                ? ` +${selectedLiveSource.paths.length - 1} more`
                                : ""}
                            </p>
                          ) : null}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="identity-live-query">
                            2. Search the selected sources
                          </FieldLabel>
                          <InputGroup>
                            <InputGroupAddon>
                              <SearchIcon />
                            </InputGroupAddon>
                            <InputGroupInput
                              id="identity-live-query"
                              onChange={(event) =>
                                setLiveQuery(event.target.value)
                              }
                              placeholder="Name, email, username, phone, or account ID"
                              value={liveQuery}
                            />
                            <InputGroupAddon align="inline-end">
                              <Select
                                items={identitySearchModes}
                                onValueChange={(value) =>
                                  setLiveMode(value as SearchMode)
                                }
                                value={liveMode}
                              >
                                <SelectTrigger size="sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {identitySearchModes.map((item) => (
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
                            </InputGroupAddon>
                          </InputGroup>
                        </Field>
                      </FieldGroup>

                      <LiveSearchPreflight
                        currentWorkerLimit={settings.data?.workerLimit ?? 2}
                        includeArchives={
                          selectedLiveSource?.includeArchives ?? true
                        }
                        source={selectedLiveSource}
                      />

                      {liveProgress ? (
                        <div className="flex flex-col gap-2">
                          <Progress value={livePercent}>
                            <ProgressLabel className="flex items-center gap-2">
                              {liveProgress.status === "running" ? (
                                <Spinner />
                              ) : null}
                              {liveProgress.message}
                            </ProgressLabel>
                            <ProgressValue>
                              {() => formatProgressPercent(livePercent)}
                            </ProgressValue>
                          </Progress>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">
                              {formatBytes(liveProgress.bytesPerSecond)}/s
                            </Badge>
                            <Badge variant="outline">
                              {liveProgress.status === "completed"
                                ? "Done"
                                : liveProgress.status === "paused"
                                  ? "Paused"
                                  : liveProgress.status === "cancelling"
                                    ? "Stopping"
                                    : `${formatDuration(
                                        liveProgress.estimatedRemainingMs,
                                      )} remaining`}
                            </Badge>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex justify-end gap-2">
                        {liveProgress?.status === "running" ? (
                          <Button
                            disabled={controlPending !== null}
                            onClick={() =>
                              void pauseLiveSearch(liveProgress.jobId)
                            }
                            size="sm"
                            variant="outline"
                          >
                            <PauseIcon data-icon="inline-start" />
                            Pause
                          </Button>
                        ) : null}
                        {liveProgress?.status === "paused" ? (
                          <Button
                            disabled={controlPending !== null}
                            onClick={() =>
                              void resumeLiveSearch(liveProgress.jobId)
                            }
                            size="sm"
                            variant="outline"
                          >
                            <PlayIcon data-icon="inline-start" />
                            Resume
                          </Button>
                        ) : null}
                        {liveProgress &&
                        ["running", "paused", "cancelling"].includes(
                          liveProgress.status,
                        ) ? (
                          <Button
                            disabled={controlPending !== null}
                            onClick={() =>
                              void cancelLiveSearch(liveProgress.jobId)
                            }
                            size="sm"
                            variant="outline"
                          >
                            <SquareIcon data-icon="inline-start" />
                            Cancel
                          </Button>
                        ) : null}
                        <Button
                          disabled={
                            !selectedLiveSource ||
                            liveQuery.trim().length < 2 ||
                            ["running", "paused", "cancelling"].includes(
                              liveProgress?.status ?? "",
                            ) ||
                            liveSearch.isPending
                          }
                          onClick={() => {
                            setLiveOffset(0);
                            setLiveSelection(new Set());
                            clearOwnLiveSearch();
                            if (selectedLiveSource) {
                              liveSearch.mutate(selectedLiveSource);
                            }
                          }}
                          size="sm"
                        >
                          {liveSearch.isPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <FileSearchIcon data-icon="inline-start" />
                          )}
                          {liveSearch.isPending
                            ? "Starting..."
                            : "Start live scan"}
                        </Button>
                      </div>
                      {controlError ? (
                        <p className="text-xs text-destructive" role="status">
                          Live scan control failed: {controlError}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>

                  <CardContent className="px-0">
                    {visibleLiveHits.length ? (
                      <Table className="table-fixed">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 ps-4" />
                            <TableHead>Source line</TableHead>
                            <TableHead className="w-2/5 pe-6">
                              Context
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleLiveHits.map((hit) => (
                            <TableRow key={hit.id}>
                              <TableCell className="ps-4">
                                <Checkbox
                                  aria-label={`Select ${formatFileNameForDisplay(hit.sourceFile)} ${hit.sourceLocation}`}
                                  checked={liveSelection.has(hit.id)}
                                  onCheckedChange={(checked) =>
                                    setLiveSelection((current) => {
                                      const next = new Set(current);
                                      if (checked) next.add(hit.id);
                                      else next.delete(hit.id);
                                      return next;
                                    })
                                  }
                                />
                              </TableCell>
                              <TableCell className="whitespace-normal">
                                <p className="font-mono text-xs break-all">
                                  {hit.excerpt}
                                </p>
                              </TableCell>
                              <TableCell className="whitespace-normal pe-6">
                                <p className="truncate text-xs font-medium">
                                  {hit.archiveEntry ??
                                    formatFileNameForDisplay(hit.sourceFile)}
                                </p>
                                <p
                                  className="truncate font-mono text-xs text-muted-foreground"
                                  title={formatPathForDisplay(hit.sourcePath)}
                                >
                                  {formatFileNameForDisplay(hit.sourceFile)} -{" "}
                                  {hit.sourceLocation}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {hit.matchReason}
                                </p>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Empty className="min-h-72 rounded-none border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            {liveProgress?.status === "running" ? (
                              <Spinner />
                            ) : (
                              <FileSearchIcon />
                            )}
                          </EmptyMedia>
                          <EmptyTitle>
                            {liveProgress?.status === "running"
                              ? "Scanning large sources"
                              : liveProgress?.status === "paused"
                                ? "Scan paused"
                                : liveProgress?.status === "cancelling"
                                  ? "Cancelling scan"
                                  : "No live evidence yet"}
                          </EmptyTitle>
                          <EmptyDescription>
                            Select matching rows and save a local identity
                            snapshot without building a full index.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                  {liveProgress?.hits.length ? (
                    <PaginationControls
                      label="live identity evidence"
                      limit={memberLimit}
                      offset={liveOffset}
                      onOffsetChange={setLiveOffset}
                      total={liveProgress.hits.length}
                    />
                  ) : null}
                </TabsContent>
              </Tabs>
            </DashboardCard>

            <DashboardCard className="gap-0">
              <CardHeader>
                <CardTitle>Identity bundle</CardTitle>
                <CardDescription>
                  {formatCount(selectedEvidenceCount)} selected evidence rows
                </CardDescription>
                <CardAction>
                  <UsersIcon />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="identity-name">
                      Identity name
                    </FieldLabel>
                    <Input
                      id="identity-name"
                      onChange={(event) => setManualName(event.target.value)}
                      placeholder="Reviewed identity"
                      value={manualName}
                    />
                    <FieldDescription>
                      The name stays local and does not change source data.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <Empty className="min-h-48 flex-1 rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FingerprintIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {selectedEvidenceCount
                        ? `${formatCount(selectedEvidenceCount)} evidence rows ready`
                        : "No evidence selected"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {selectedEvidenceCount >= 2
                        ? "Name the bundle, then create the reviewed identity."
                        : selectedEvidenceCount === 1
                          ? "Select one more evidence row to create an identity."
                          : "Select reviewed indexed or live evidence to build this identity."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
              <CardFooter className="mt-auto rounded-none bg-background">
                <Button
                  className="w-full"
                  disabled={
                    !manualName.trim() ||
                    selectedEvidenceCount < 2 ||
                    create.isPending
                  }
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <UsersIcon data-icon="inline-start" />
                  )}
                  {create.isPending ? "Creating…" : "Create identity"}
                </Button>
              </CardFooter>
            </DashboardCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
