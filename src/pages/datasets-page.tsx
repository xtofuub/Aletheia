import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  DatabaseIcon,
  FilePlus2Icon,
  FileSearchIcon,
  FolderOpenIcon,
  GaugeIcon,
  MonitorIcon,
  NetworkIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
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
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelImport,
  createLiveSource,
  deleteDataset,
  deleteLiveSource,
  getActiveImport,
  getSystemStatus,
  inspectSources,
  isTauriRuntime,
  listDatasets,
  listLiveSources,
  listenImportProgress,
  pauseImport,
  resumeDatasetImport,
  resumeImport,
  selectSourceFiles,
  selectSourceFolder,
  selectDirectSearchSources,
  startImport,
  type ImportOptions,
  type ImportProgress,
  type InspectionResult,
  type DatasetSummary,
  type LiveSourceSummary,
} from "@/lib/desktop";
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatFileNameForDisplay,
  formatPathForDisplay,
  formatRate,
} from "@/lib/format";
import {
  isTerminalImportStatus,
  mergeImportProgress,
  type ImportControlStatus,
} from "@/lib/import-progress";

type ImportProfile = "fast" | "analysis";

const fastIndexOptions: ImportOptions = {
  skipInvalidRows: true,
  stopOnSevereError: true,
  extractUrls: false,
  extractDomains: false,
  groupIdentities: false,
  deduplicate: false,
  storeOffsets: true,
};

const analysisIndexOptions: ImportOptions = {
  ...fastIndexOptions,
  extractUrls: true,
  extractDomains: true,
  groupIdentities: true,
};

function isLargeInspection(result: InspectionResult) {
  return (
    result.totalBytes >= 1024 ** 3 ||
    result.files.some((file) => (file.estimatedRecords ?? 0) >= 4_000_000)
  );
}

function sourceNameFromPath(path: string, count: number) {
  const segments = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  const base = segments.at(-1) || "Saved live source";
  return count > 1 ? `${base} + ${count - 1} more` : base;
}

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [inspectionKind, setInspectionKind] = useState<"files" | "folder">(
    "files",
  );
  const [datasetLabel, setDatasetLabel] = useState("");
  const [authorizationNote, setAuthorizationNote] = useState("");
  const [importProfile, setImportProfile] = useState<ImportProfile>("analysis");
  const [options, setOptions] = useState(analysisIndexOptions);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [recordsPerSecond, setRecordsPerSecond] = useState(0);
  const [bytesPerSecond, setBytesPerSecond] = useState(0);
  const [controlPending, setControlPending] =
    useState<ImportControlStatus | null>(null);
  const [actionError, setActionError] = useState("");
  const [resumingDatasetId, setResumingDatasetId] = useState<string | null>(
    null,
  );
  const [datasetToRemove, setDatasetToRemove] = useState<DatasetSummary | null>(
    null,
  );
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [liveSourceName, setLiveSourceName] = useState("");
  const [liveSourcePaths, setLiveSourcePaths] = useState<string[]>([]);
  const [liveSourceArchives, setLiveSourceArchives] = useState(true);
  const [liveSourceToRemove, setLiveSourceToRemove] =
    useState<LiveSourceSummary | null>(null);
  const previous = useRef<{
    jobId: string;
    at: number;
    records: number;
    bytes: number;
    status: string;
  } | null>(null);
  const forcedControl = useRef<{
    jobId: string;
    status: ImportControlStatus;
  } | null>(null);

  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets,
    refetchInterval: 3_000,
  });
  const activeImport = useQuery({
    queryKey: ["active-import"],
    queryFn: getActiveImport,
    refetchInterval: progress ? false : 1_000,
  });
  const liveSources = useQuery({
    queryKey: ["live-sources"],
    queryFn: listLiveSources,
  });
  const system = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
  });
  const nativeRuntime = isTauriRuntime();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenImportProgress((next) => {
      const now = performance.now();
      let forcedStatus =
        forcedControl.current?.jobId === next.jobId
          ? forcedControl.current.status
          : null;
      if (
        forcedStatus !== "cancelling" &&
        next.status === forcedStatus &&
        forcedControl.current?.jobId === next.jobId
      ) {
        forcedControl.current = null;
        forcedStatus = null;
      }
      if (
        next.status === "running" &&
        forcedStatus === null &&
        previous.current &&
        previous.current.jobId === next.jobId &&
        previous.current.status === "running" &&
        previous.current.at < now
      ) {
        const seconds = (now - previous.current.at) / 1_000;
        const recordRate = Math.max(
          0,
          (next.recordsProcessed - previous.current.records) / seconds,
        );
        const byteRate = Math.max(
          0,
          (next.bytesRead - previous.current.bytes) / seconds,
        );
        setRecordsPerSecond((current) =>
          current > 0 ? current * 0.7 + recordRate * 0.3 : recordRate,
        );
        setBytesPerSecond((current) =>
          current > 0 ? current * 0.7 + byteRate * 0.3 : byteRate,
        );
      } else {
        setRecordsPerSecond(0);
        setBytesPerSecond(0);
      }
      previous.current = {
        jobId: next.jobId,
        at: now,
        records: next.recordsProcessed,
        bytes: next.bytesRead,
        status: next.status,
      };
      setProgress((current) =>
        mergeImportProgress(current, next, forcedStatus),
      );
      if (isTerminalImportStatus(next.status)) {
        if (forcedControl.current?.jobId === next.jobId) {
          forcedControl.current = null;
          setControlPending(null);
        }
        void queryClient.invalidateQueries({ queryKey: ["datasets"] });
        void queryClient.invalidateQueries({ queryKey: ["overview"] });
      }
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, [queryClient]);

  const inspect = useMutation({
    mutationFn: (kind: "files" | "folder") =>
      (kind === "files" ? selectSourceFiles() : selectSourceFolder()).then(
        async (paths) => {
          if (!paths.length) return null;
          return inspectSources(paths);
        },
      ),
    onSuccess: (result, kind) => {
      if (!result) return;
      if (result.files.length === 0) {
        setInspection(null);
        setActionError(
          "No supported files were found. Persistent indexing accepts TXT, CSV, TSV, JSONL, NDJSON, LOG, and GZIP files.",
        );
        return;
      }
      setActionError("");
      setInspection(result);
      setInspectionKind(kind);
      const recommendedProfile: ImportProfile = isLargeInspection(result)
        ? "fast"
        : "analysis";
      setImportProfile(recommendedProfile);
      setOptions(
        recommendedProfile === "fast" ? fastIndexOptions : analysisIndexOptions,
      );
      setDatasetLabel(
        result.files[0]?.fileName.replace(/\.[^.]+$/, "") ??
          "Authorized dataset",
      );
      setDialogOpen(true);
    },
    onError: (error) => setActionError(String(error)),
  });

  const start = useMutation({
    mutationFn: async () => {
      if (!inspection) throw new Error("Choose a source first.");
      return startImport({
        datasetLabel: datasetLabel.trim(),
        authorizationNote: authorizationNote.trim(),
        files: inspection.files.filter((file) => file.eligible),
        options,
      });
    },
    onSuccess: async (result) => {
      setActionError("");
      forcedControl.current = null;
      setControlPending(null);
      const queued: ImportProgress = {
        jobId: result.jobId,
        datasetId: result.datasetId,
        status: "queued",
        currentFile: null,
        bytesRead: 0,
        totalBytes: inspection?.totalBytes ?? 0,
        recordsProcessed: 0,
        recordsIndexed: 0,
        invalidRecords: 0,
        duplicateRecords: 0,
        message: "Import queued",
      };
      setProgress((current) => mergeImportProgress(current, queued));
      setDialogOpen(false);
      setInspection(null);
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => setActionError(String(error)),
  });

  const remove = useMutation({
    mutationFn: (datasetId: string) => deleteDataset(datasetId),
    onSuccess: async () => {
      setActionError("");
      setDatasetToRemove(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["datasets"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
      ]);
    },
    onError: (error) => setActionError(String(error)),
  });

  const saveLiveSource = useMutation({
    mutationFn: () =>
      createLiveSource({
        name: liveSourceName.trim(),
        paths: liveSourcePaths,
        includeArchives: liveSourceArchives,
      }),
    onSuccess: async () => {
      setActionError("");
      setLiveDialogOpen(false);
      setLiveSourceName("");
      setLiveSourcePaths([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["live-sources"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
    onError: (error) => setActionError(String(error)),
  });

  const removeLiveSource = useMutation({
    mutationFn: (id: string) => deleteLiveSource(id),
    onSuccess: async () => {
      setActionError("");
      setLiveSourceToRemove(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["live-sources"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
    onError: (error) => setActionError(String(error)),
  });

  async function chooseLiveSource(kind: "files" | "folder") {
    const paths = await selectDirectSearchSources(kind);
    const firstPath = paths[0];
    if (!firstPath) return;
    setActionError("");
    setLiveSourcePaths(paths);
    setLiveSourceName(sourceNameFromPath(firstPath, paths.length));
    setLiveDialogOpen(true);
  }

  async function continueDataset(dataset: DatasetSummary) {
    setResumingDatasetId(dataset.id);
    try {
      const result = await resumeDatasetImport(dataset.id);
      setActionError("");
      forcedControl.current = null;
      setControlPending(null);
      const queued: ImportProgress = {
        jobId: result.jobId,
        datasetId: result.datasetId,
        status: "queued",
        currentFile: null,
        bytesRead: 0,
        totalBytes: dataset.totalBytes,
        recordsProcessed: dataset.recordCount,
        recordsIndexed: dataset.recordCount,
        invalidRecords: 0,
        duplicateRecords: 0,
        message: "Resume queued",
      };
      setProgress((current) => mergeImportProgress(current, queued));
    } catch (error) {
      setActionError(String(error));
    } finally {
      setResumingDatasetId(null);
    }
  }

  async function requestPause(jobId: string) {
    forcedControl.current = { jobId, status: "paused" };
    setControlPending("paused");
    setProgress((current) => {
      const snapshot = current ?? activeImport.data ?? null;
      return snapshot?.jobId === jobId
        ? mergeImportProgress(current, snapshot, "paused")
        : current;
    });
    try {
      await pauseImport(jobId);
      setActionError("");
    } catch (error) {
      forcedControl.current = null;
      setActionError(String(error));
      setProgress((await getActiveImport()) ?? null);
    } finally {
      setControlPending(null);
    }
  }

  async function requestContinue(jobId: string) {
    forcedControl.current = { jobId, status: "running" };
    setControlPending("running");
    setProgress((current) => {
      const snapshot = current ?? activeImport.data ?? null;
      return snapshot?.jobId === jobId
        ? mergeImportProgress(current, snapshot, "running")
        : current;
    });
    try {
      await resumeImport(jobId);
      setActionError("");
    } catch (error) {
      forcedControl.current = null;
      setActionError(String(error));
      setProgress((await getActiveImport()) ?? null);
    } finally {
      setControlPending(null);
    }
  }

  async function requestCancel(jobId: string) {
    forcedControl.current = { jobId, status: "cancelling" };
    setControlPending("cancelling");
    setProgress((current) => {
      const snapshot = current ?? activeImport.data ?? null;
      return snapshot?.jobId === jobId
        ? mergeImportProgress(current, snapshot, "cancelling")
        : current;
    });
    try {
      await cancelImport(jobId);
      setActionError("");
    } catch (error) {
      forcedControl.current = null;
      setActionError(String(error));
      setProgress((await getActiveImport()) ?? null);
    } finally {
      setControlPending(null);
    }
  }

  const visibleProgress = progress ?? activeImport.data ?? null;
  const active =
    visibleProgress &&
    ["queued", "running", "paused", "cancelling"].includes(
      visibleProgress.status,
    );
  const workspaceImportActive =
    Boolean(active) ||
    (datasets.data ?? []).some((dataset) =>
      ["queued", "indexing", "paused", "cancelling"].includes(dataset.status),
    );
  const percent = visibleProgress?.totalBytes
    ? Math.min(
        100,
        (visibleProgress.bytesRead / visibleProgress.totalBytes) * 100,
      )
    : 0;
  const largeInspection = Boolean(inspection && isLargeInspection(inspection));
  const estimatedIndexBytes = inspection
    ? {
        low: inspection.totalBytes * (importProfile === "fast" ? 0.35 : 0.8),
        high: inspection.totalBytes * (importProfile === "fast" ? 0.8 : 1.8),
      }
    : null;
  const importEtaMs =
    visibleProgress &&
    bytesPerSecond > 0 &&
    visibleProgress.bytesRead < visibleProgress.totalBytes
      ? ((visibleProgress.totalBytes - visibleProgress.bytesRead) /
          bytesPerSecond) *
        1_000
      : null;

  return (
    <div>
      <PageHeader
        description="Save huge sources for live lookup, or recursively index supported files for repeated search."
        title="Datasets"
      />

      {!nativeRuntime ? (
        <Alert className="mb-4">
          <MonitorIcon />
          <AlertTitle>Browser preview uses sample data</AlertTitle>
          <AlertDescription>
            Localhost cannot open the native SQLite and Tantivy workspace. Open
            the installed desktop app to see datasets you indexed previously.
          </AlertDescription>
        </Alert>
      ) : null}

      {system.data?.orphanedIndex ? (
        <Alert className="mb-4" variant="destructive">
          <DatabaseIcon />
          <AlertTitle>Indexed documents are missing their metadata</AlertTitle>
          <AlertDescription>
            This folder contains {formatCount(system.data.indexedDocuments)}
            indexed documents but no dataset catalog. Select the original
            workspace in Settings, or re-index the source files. Source files
            were not changed. <a href="#/settings">Open storage settings.</a>
          </AlertDescription>
        </Alert>
      ) : null}

      {actionError ? (
        <Alert className="mb-4" variant="destructive">
          <AlertTitle>Dataset action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2">
        <DashboardCard className="min-h-56">
          <CardHeader>
            <CardTitle>Saved Live sources</CardTitle>
            <CardDescription>
              Register huge files or folders once, then search them anytime
              without building an index.
            </CardDescription>
            <CardAction>
              <Badge>Recommended</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">TXT · ZIP · RAR · GZIP</Badge>
              <Badge variant="outline">HDD friendly</Badge>
              <Badge variant="outline">No extraction</Badge>
            </div>
            <Separator />
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Source files stay untouched. Removing a saved source only
                removes its local catalog entry.
              </span>
              <div className="flex gap-2">
                <Button
                  onClick={() => void chooseLiveSource("folder")}
                  size="sm"
                  variant="outline"
                >
                  <FolderOpenIcon data-icon="inline-start" />
                  Save folder
                </Button>
                <Button
                  onClick={() => void chooseLiveSource("files")}
                  size="sm"
                >
                  <FileSearchIcon data-icon="inline-start" />
                  Save files
                </Button>
              </div>
            </div>
          </CardContent>
        </DashboardCard>
        <DashboardCard className="min-h-56">
          <CardHeader>
            <CardTitle>Persistent index</CardTitle>
            <CardDescription>
              Build a reusable local index from selected files or every
              supported file inside a folder and its subfolders.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">Reusable</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Fast repeated search</Badge>
              <Badge variant="outline">Recursive folders</Badge>
              <Badge variant="outline">Domains</Badge>
              <Badge variant="outline">Identities</Badge>
              <Badge variant="outline">Resumable</Badge>
              <Badge variant="outline">Crash checkpoints</Badge>
            </div>
            <Separator />
            <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                disabled={inspect.isPending || workspaceImportActive}
                onClick={() => inspect.mutate("folder")}
                size="sm"
                variant="outline"
              >
                {inspect.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FolderOpenIcon data-icon="inline-start" />
                )}
                {inspect.isPending
                  ? "Reading…"
                  : workspaceImportActive
                    ? "Indexing active"
                    : "Index folder"}
              </Button>
              <Button
                disabled={inspect.isPending || workspaceImportActive}
                onClick={() => inspect.mutate("files")}
                size="sm"
                variant="outline"
              >
                {inspect.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FilePlus2Icon data-icon="inline-start" />
                )}
                {inspect.isPending
                  ? "Reading…"
                  : workspaceImportActive
                    ? "Indexing active"
                    : "Index files"}
              </Button>
            </div>
          </CardContent>
        </DashboardCard>
      </div>

      <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-4">
        {visibleProgress ? (
          <DashboardCard className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Indexing telemetry</CardTitle>
              <CardDescription>{visibleProgress.message}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Progress value={percent}>
                <ProgressLabel>
                  {visibleProgress.currentFile
                    ? formatFileNameForDisplay(visibleProgress.currentFile)
                    : visibleProgress.status}
                </ProgressLabel>
                <ProgressValue>{() => `${percent.toFixed(0)}%`}</ProgressValue>
              </Progress>
              <div className="grid grid-cols-2 gap-px bg-border p-px sm:grid-cols-5">
                {[
                  ["Indexed", formatCount(visibleProgress.recordsIndexed)],
                  ["Record speed", formatRate(recordsPerSecond)],
                  ["Read speed", `${formatBytes(bytesPerSecond)}/s`],
                  [
                    "Time remaining",
                    visibleProgress.status === "completed"
                      ? "Done"
                      : formatDuration(importEtaMs),
                  ],
                  ["Invalid", formatCount(visibleProgress.invalidRecords)],
                ].map(([label, value]) => (
                  <div className="bg-background p-3" key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-mono text-sm tabular-nums">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
            {active ? (
              <CardFooter className="justify-end gap-2 rounded-none bg-background">
                {visibleProgress.status === "cancelling" ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner />
                    Finishing cancellation before another index can start
                  </span>
                ) : visibleProgress.status === "paused" ? (
                  <Button
                    disabled={controlPending !== null}
                    onClick={() => void requestContinue(visibleProgress.jobId)}
                    size="sm"
                    variant="outline"
                  >
                    <PlayIcon data-icon="inline-start" />
                    Continue
                  </Button>
                ) : (
                  <Button
                    disabled={controlPending !== null}
                    onClick={() => void requestPause(visibleProgress.jobId)}
                    size="sm"
                    variant="outline"
                  >
                    <PauseIcon data-icon="inline-start" />
                    Pause
                  </Button>
                )}
                {visibleProgress.status !== "cancelling" ? (
                  <Button
                    disabled={controlPending !== null}
                    onClick={() => void requestCancel(visibleProgress.jobId)}
                    size="sm"
                    variant="outline"
                  >
                    <SquareIcon data-icon="inline-start" />
                    Cancel
                  </Button>
                ) : null}
              </CardFooter>
            ) : null}
          </DashboardCard>
        ) : null}

        <DashboardCard className="gap-0 lg:col-span-4">
          <CardHeader className="border-b">
            <CardTitle>Search sources</CardTitle>
            <CardDescription>
              {(datasets.data?.length ?? 0) + (liveSources.data?.length ?? 0)}{" "}
              reusable sources registered in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {datasets.data?.length || liveSources.data?.length ? (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20 ps-6">Type</TableHead>
                    <TableHead className="w-1/3">Source</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-16">Files</TableHead>
                    <TableHead className="w-24">Size</TableHead>
                    <TableHead className="w-24">Records</TableHead>
                    <TableHead className="hidden 2xl:table-cell">
                      Updated
                    </TableHead>
                    <TableHead className="w-28 pe-6 text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(liveSources.data ?? []).map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="ps-6">
                        <Badge>Live</Badge>
                      </TableCell>
                      <TableCell className="min-w-0 whitespace-normal">
                        <p className="truncate font-medium">{source.name}</p>
                        <p
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={formatPathForDisplay(source.paths[0] ?? "")}
                        >
                          {formatPathForDisplay(source.paths[0] ?? "")}
                          {source.paths.length > 1
                            ? ` + ${source.paths.length - 1} more`
                            : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">On demand</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {source.paths.length}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        On scan
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        On scan
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground 2xl:table-cell">
                        {formatDateTime(source.createdAt)}
                      </TableCell>
                      <TableCell className="w-28 pe-6 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            nativeButton={false}
                            render={
                              <a
                                href={`#/search?source=${encodeURIComponent(`live:${source.id}`)}`}
                              />
                            }
                            size="sm"
                            variant="ghost"
                          >
                            Search
                          </Button>
                          <Button
                            aria-label={`Remove ${source.name}`}
                            onClick={() => setLiveSourceToRemove(source)}
                            size="icon-sm"
                            variant="ghost"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(datasets.data ?? []).map((dataset) => {
                    const resumable = [
                      "cancelled",
                      "interrupted",
                      "failed",
                      "paused",
                    ].includes(dataset.status);
                    return (
                      <TableRow key={dataset.id}>
                        <TableCell className="ps-6">
                          <Badge variant="outline">Index</Badge>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-normal">
                          <p className="truncate font-medium">{dataset.name}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{dataset.status}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {dataset.fileCount}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatBytes(dataset.totalBytes)}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {formatCount(dataset.recordCount)}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground 2xl:table-cell">
                          {formatDateTime(dataset.lastIndexedAt)}
                        </TableCell>
                        <TableCell className="w-28 pe-6 text-right">
                          <div className="flex justify-end gap-1">
                            {resumable ? (
                              <Button
                                disabled={
                                  workspaceImportActive ||
                                  resumingDatasetId === dataset.id
                                }
                                onClick={() => void continueDataset(dataset)}
                                size="sm"
                                variant="outline"
                              >
                                {resumingDatasetId === dataset.id ? (
                                  <Spinner data-icon="inline-start" />
                                ) : (
                                  <RotateCcwIcon data-icon="inline-start" />
                                )}
                                {resumingDatasetId === dataset.id
                                  ? "Resuming…"
                                  : "Resume"}
                              </Button>
                            ) : (
                              <Button
                                nativeButton={false}
                                render={
                                  <a
                                    href={`#/search?source=${encodeURIComponent(`index:${dataset.id}`)}`}
                                  />
                                }
                                size="sm"
                                variant="ghost"
                              >
                                Search
                              </Button>
                            )}
                            <Button
                              aria-label={`Remove ${dataset.name}`}
                              disabled={Boolean(active)}
                              onClick={() => setDatasetToRemove(dataset)}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Empty className="min-h-80 rounded-none border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UploadIcon />
                  </EmptyMedia>
                  <EmptyTitle>No search sources</EmptyTitle>
                  <EmptyDescription>
                    Save a huge source for on-demand scans, or build a
                    persistent index for repeated lookup.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={workspaceImportActive}
                    onClick={() => inspect.mutate("files")}
                    size="sm"
                  >
                    <FilePlus2Icon data-icon="inline-start" />
                    Choose files
                  </Button>
                  <Button
                    onClick={() => void chooseLiveSource("files")}
                    size="sm"
                    variant="outline"
                  >
                    <FileSearchIcon data-icon="inline-start" />
                    Save Live source
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </DashboardCard>
      </div>

      <Dialog onOpenChange={setLiveDialogOpen} open={liveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Live source</DialogTitle>
            <DialogDescription>
              Keep these locations in the workspace so every future search can
              scan them without choosing the files again.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="live-source-name">Name</FieldLabel>
              <Input
                autoFocus
                id="live-source-name"
                onChange={(event) => setLiveSourceName(event.target.value)}
                value={liveSourceName}
              />
            </Field>
            <Field>
              <FieldLabel>Locations</FieldLabel>
              <div className="flex max-h-40 flex-col gap-2 overflow-y-auto border p-3">
                {liveSourcePaths.map((path) => (
                  <div className="flex min-w-0 items-center gap-2" key={path}>
                    <FileSearchIcon className="shrink-0" />
                    <span className="min-w-0 truncate font-mono text-xs">
                      {formatPathForDisplay(path)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void chooseLiveSource("folder")}
                  size="sm"
                  variant="outline"
                >
                  <FolderOpenIcon data-icon="inline-start" />
                  Choose folder
                </Button>
                <Button
                  onClick={() => void chooseLiveSource("files")}
                  size="sm"
                  variant="outline"
                >
                  <FileSearchIcon data-icon="inline-start" />
                  Choose files
                </Button>
              </div>
            </Field>
            <Field orientation="horizontal">
              <div>
                <FieldLabel>Include compressed archives</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Stream ZIP, RAR, and GZIP entries without extracting them.
                </p>
              </div>
              <Switch
                checked={liveSourceArchives}
                onCheckedChange={setLiveSourceArchives}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={saveLiveSource.isPending}
              onClick={() => setLiveDialogOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !liveSourceName.trim() ||
                !liveSourcePaths.length ||
                saveLiveSource.isPending
              }
              onClick={() => saveLiveSource.mutate()}
            >
              {saveLiveSource.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {saveLiveSource.isPending ? "Saving…" : "Save source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review import</DialogTitle>
            <DialogDescription>
              {inspection
                ? `${inspection.files.length.toLocaleString()} supported ${
                    inspection.files.length === 1 ? "file" : "files"
                  } discovered from ${
                    inspectionKind === "folder"
                      ? "the selected folder and its subfolders"
                      : "your file selection"
                  }.`
                : "Review the selected local sources."}
            </DialogDescription>
          </DialogHeader>
          {inspection ? (
            <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
                <Badge>
                  {inspection.files.length.toLocaleString()} files queued
                </Badge>
                <Badge variant="outline">
                  {formatBytes(inspection.totalBytes)} total
                </Badge>
                <Badge variant="outline">
                  {inspectionKind === "folder"
                    ? "Recursive folder scan"
                    : "Multi-file selection"}
                </Badge>
                {inspection.rejectedPaths.length ? (
                  <Badge variant="secondary">
                    {inspection.rejectedPaths.length.toLocaleString()} skipped
                  </Badge>
                ) : null}
              </div>
              {largeInspection ? (
                <Alert>
                  <FileSearchIcon />
                  <AlertTitle>Live scan is faster to start</AlertTitle>
                  <AlertDescription>
                    This is a large selection. Use one-pass live scan for
                    immediate lookup. Build an index only when repeated search
                    speed or relationship analysis justifies the extra time and
                    disk space.
                  </AlertDescription>
                  <div className="col-start-2 mt-2">
                    <Button
                      onClick={() => {
                        setDialogOpen(false);
                        void chooseLiveSource("folder");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <FileSearchIcon data-icon="inline-start" />
                      Save a Live source
                    </Button>
                  </div>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel>Index profile</FieldLabel>
                <ToggleGroup
                  onValueChange={(values) => {
                    const profile = values[0] as ImportProfile | undefined;
                    if (!profile) return;
                    setImportProfile(profile);
                    setOptions(
                      profile === "fast"
                        ? fastIndexOptions
                        : analysisIndexOptions,
                    );
                  }}
                  size="sm"
                  value={[importProfile]}
                  variant="outline"
                >
                  <ToggleGroupItem value="fast">
                    <GaugeIcon data-icon="inline-start" />
                    Fast index
                  </ToggleGroupItem>
                  <ToggleGroupItem value="analysis">
                    <NetworkIcon data-icon="inline-start" />
                    Relationship index
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {importProfile === "fast"
                    ? "Searchable records and source locations only. Domains and automatic identities stay off."
                    : "Adds domains and automatic identity candidates. This requires more CPU, disk, and time."}
                </FieldDescription>
                {estimatedIndexBytes ? (
                  <FieldDescription>
                    Plan roughly {formatBytes(estimatedIndexBytes.low)} to{" "}
                    {formatBytes(estimatedIndexBytes.high)} of generated
                    storage. Actual size depends on field lengths and
                    repetition.
                  </FieldDescription>
                ) : null}
              </Field>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="dataset-label">Dataset name</FieldLabel>
                  <Input
                    id="dataset-label"
                    onChange={(event) => setDatasetLabel(event.target.value)}
                    value={datasetLabel}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="authorization-note">
                    Authorization note
                  </FieldLabel>
                  <Input
                    id="authorization-note"
                    onChange={(event) =>
                      setAuthorizationNote(event.target.value)
                    }
                    placeholder="Optional local audit note"
                    value={authorizationNote}
                  />
                  <FieldDescription>
                    This note stays in local metadata.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Files to index</FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    All discovered files are shown
                  </span>
                </div>
                <ScrollArea className="h-56 border">
                  <Table className="table-fixed">
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-1/2 ps-4">Path</TableHead>
                        <TableHead>Format</TableHead>
                        <TableHead>Encoding</TableHead>
                        <TableHead>Rows</TableHead>
                        <TableHead className="pe-4 text-right">Size</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inspection.files.map((file) => (
                        <TableRow key={file.absolutePath}>
                          <TableCell className="min-w-0 ps-4 whitespace-normal">
                            <p
                              className="truncate font-medium"
                              title={file.relativePath}
                            >
                              {file.relativePath || file.fileName}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{file.format}</Badge>
                          </TableCell>
                          <TableCell className="truncate text-xs">
                            {file.encoding}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {file.estimatedRecords?.toLocaleString() ??
                              "Unknown"}
                          </TableCell>
                          <TableCell className="pe-4 text-right font-mono text-xs">
                            {formatBytes(file.fileSize)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <FieldDescription>
                  Persistent indexing supports TXT, CSV, TSV, JSONL, NDJSON,
                  LOG, and GZIP. Use a saved Live source for ZIP or RAR
                  archives.
                </FieldDescription>
              </Field>
              <FieldGroup>
                {(
                  [
                    [
                      "deduplicate",
                      "Deduplicate records",
                      "Spend more time to reduce exact duplicates.",
                    ],
                    [
                      "storeOffsets",
                      "Store source offsets",
                      "Keep fast source-location traceability.",
                    ],
                  ] as const
                ).map(([key, title, description]) => (
                  <Field key={key} orientation="horizontal">
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="text-xs text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(options[key as keyof ImportOptions])}
                      onCheckedChange={(checked) =>
                        setOptions((current) => ({
                          ...current,
                          [key]: checked,
                        }))
                      }
                    />
                  </Field>
                ))}
              </FieldGroup>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={
                !datasetLabel.trim() || start.isPending || workspaceImportActive
              }
              onClick={() => start.mutate()}
            >
              {start.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              {start.isPending ? "Starting…" : "Build index"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDatasetToRemove(null);
        }}
        open={Boolean(datasetToRemove)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove this dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              Aletheia will delete generated index entries and metadata for “
              {datasetToRemove?.name}”. The original source files will not be
              changed or deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || !datasetToRemove}
              onClick={() => {
                if (datasetToRemove) remove.mutate(datasetToRemove.id);
              }}
              variant="destructive"
            >
              {remove.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {remove.isPending ? "Removing…" : "Remove dataset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !removeLiveSource.isPending) {
            setLiveSourceToRemove(null);
          }
        }}
        open={Boolean(liveSourceToRemove)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove this Live source?</AlertDialogTitle>
            <AlertDialogDescription>
              Aletheia will forget “{liveSourceToRemove?.name}”. The original
              files and archives will not be changed or deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeLiveSource.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removeLiveSource.isPending || !liveSourceToRemove}
              onClick={() => {
                if (liveSourceToRemove) {
                  removeLiveSource.mutate(liveSourceToRemove.id);
                }
              }}
              variant="destructive"
            >
              {removeLiveSource.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {removeLiveSource.isPending ? "Removing…" : "Remove source"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
