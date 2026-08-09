import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  FilePlus2Icon,
  FileSearchIcon,
  FolderOpenIcon,
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
  deleteDataset,
  inspectSources,
  listDatasets,
  listenImportProgress,
  pauseImport,
  resumeDatasetImport,
  resumeImport,
  selectSourceFiles,
  selectSourceFolder,
  startImport,
  type ImportOptions,
  type ImportProgress,
  type InspectionResult,
  type DatasetSummary,
} from "@/lib/desktop";
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatRate,
} from "@/lib/format";

const defaultOptions: ImportOptions = {
  skipInvalidRows: true,
  stopOnSevereError: true,
  extractUrls: true,
  extractDomains: true,
  groupIdentities: true,
  deduplicate: false,
  storeOffsets: true,
};

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [datasetLabel, setDatasetLabel] = useState("");
  const [authorizationNote, setAuthorizationNote] = useState("");
  const [options, setOptions] = useState(defaultOptions);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [recordsPerSecond, setRecordsPerSecond] = useState(0);
  const [bytesPerSecond, setBytesPerSecond] = useState(0);
  const [actionError, setActionError] = useState("");
  const [resumingDatasetId, setResumingDatasetId] = useState<string | null>(
    null,
  );
  const [datasetToRemove, setDatasetToRemove] = useState<DatasetSummary | null>(
    null,
  );
  const previous = useRef<{
    at: number;
    records: number;
    bytes: number;
  } | null>(null);

  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenImportProgress((next) => {
      const now = performance.now();
      if (previous.current && previous.current.at < now) {
        const seconds = (now - previous.current.at) / 1_000;
        setRecordsPerSecond(
          Math.max(
            0,
            (next.recordsProcessed - previous.current.records) / seconds,
          ),
        );
        setBytesPerSecond(
          Math.max(0, (next.bytesRead - previous.current.bytes) / seconds),
        );
      }
      previous.current = {
        at: now,
        records: next.recordsProcessed,
        bytes: next.bytesRead,
      };
      setProgress(next);
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          next.status,
        )
      ) {
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
    onSuccess: (result) => {
      if (!result) return;
      setActionError("");
      setInspection(result);
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
      setProgress({
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
      });
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

  async function continueDataset(dataset: DatasetSummary) {
    setResumingDatasetId(dataset.id);
    try {
      const result = await resumeDatasetImport(dataset.id);
      setActionError("");
      setProgress({
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
      });
    } catch (error) {
      setActionError(String(error));
    } finally {
      setResumingDatasetId(null);
    }
  }

  const active =
    progress &&
    ["queued", "running", "paused", "cancelling"].includes(progress.status);
  const percent = progress?.totalBytes
    ? Math.min(100, (progress.bytesRead / progress.totalBytes) * 100)
    : 0;
  const largeInspection = Boolean(
    inspection &&
    (inspection.totalBytes >= 1024 ** 3 ||
      inspection.files.some(
        (file) => (file.estimatedRecords ?? 0) >= 4_000_000,
      )),
  );

  return (
    <div>
      <PageHeader
        description="Scan very large sources immediately, or index smaller collections you search repeatedly."
        title="Datasets"
      />

      {actionError ? (
        <Alert className="mb-4" variant="destructive">
          <AlertTitle>Dataset action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2">
        <DashboardCard className="min-h-56">
          <CardHeader>
            <CardTitle>Live scan</CardTitle>
            <CardDescription>
              Search huge files and compressed archives immediately. Nothing is
              imported, extracted, or added to the workspace.
            </CardDescription>
            <CardAction>
              <Badge>Recommended</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">TXT · ZIP · RAR · GZIP</Badge>
              <Badge variant="outline">HDD friendly</Badge>
              <Badge variant="outline">One-time lookup</Badge>
            </div>
            <Separator />
            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Choose a source and query, then scan without creating an index.
              </span>
              <Button
                nativeButton={false}
                render={<a href="#/search?surface=direct" />}
                size="sm"
              >
                <FileSearchIcon data-icon="inline-start" />
                Start live scan
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        </DashboardCard>
        <DashboardCard className="min-h-56">
          <CardHeader>
            <CardTitle>Persistent index</CardTitle>
            <CardDescription>
              Build a reusable local index for fast repeated searches, domain
              exploration, and identity grouping.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">Reusable</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Fast repeated search</Badge>
              <Badge variant="outline">Domains</Badge>
              <Badge variant="outline">Identities</Badge>
              <Badge variant="outline">Resumable</Badge>
            </div>
            <Separator />
            <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                disabled={inspect.isPending}
                onClick={() => inspect.mutate("folder")}
                size="sm"
                variant="outline"
              >
                {inspect.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FolderOpenIcon data-icon="inline-start" />
                )}
                {inspect.isPending ? "Reading…" : "Index folder"}
              </Button>
              <Button
                disabled={inspect.isPending}
                onClick={() => inspect.mutate("files")}
                size="sm"
                variant="outline"
              >
                {inspect.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FilePlus2Icon data-icon="inline-start" />
                )}
                {inspect.isPending ? "Reading…" : "Index files"}
              </Button>
            </div>
          </CardContent>
        </DashboardCard>
      </div>

      <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-4">
        {progress ? (
          <DashboardCard className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Indexing telemetry</CardTitle>
              <CardDescription>{progress.message}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Progress value={percent}>
                <ProgressLabel>
                  {progress.currentFile ?? progress.status}
                </ProgressLabel>
                <ProgressValue>{() => `${percent.toFixed(0)}%`}</ProgressValue>
              </Progress>
              <div className="grid grid-cols-2 gap-px bg-border p-px sm:grid-cols-4">
                {[
                  ["Indexed", formatCount(progress.recordsIndexed)],
                  ["Record speed", formatRate(recordsPerSecond)],
                  ["Read speed", `${formatBytes(bytesPerSecond)}/s`],
                  ["Invalid", formatCount(progress.invalidRecords)],
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
                {progress.status === "paused" ? (
                  <Button
                    onClick={() => void resumeImport(progress.jobId)}
                    size="sm"
                    variant="outline"
                  >
                    <PlayIcon data-icon="inline-start" />
                    Continue
                  </Button>
                ) : (
                  <Button
                    onClick={() => void pauseImport(progress.jobId)}
                    size="sm"
                    variant="outline"
                  >
                    <PauseIcon data-icon="inline-start" />
                    Pause
                  </Button>
                )}
                <Button
                  onClick={() => void cancelImport(progress.jobId)}
                  size="sm"
                  variant="outline"
                >
                  <SquareIcon data-icon="inline-start" />
                  Cancel
                </Button>
              </CardFooter>
            ) : null}
          </DashboardCard>
        ) : null}

        <DashboardCard className="gap-0 lg:col-span-4">
          <CardHeader className="border-b">
            <CardTitle>Local datasets</CardTitle>
            <CardDescription>
              {datasets.data?.length ?? 0} sources registered in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {datasets.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">Dataset</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Last indexed</TableHead>
                    <TableHead className="pe-6 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.data.map((dataset) => {
                    const resumable = [
                      "cancelled",
                      "interrupted",
                      "failed",
                      "paused",
                    ].includes(dataset.status);
                    return (
                      <TableRow key={dataset.id}>
                        <TableCell className="max-w-72 truncate ps-6 font-medium">
                          {dataset.name}
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
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(dataset.lastIndexedAt)}
                        </TableCell>
                        <TableCell className="pe-6 text-right">
                          <div className="flex justify-end gap-1">
                            {resumable ? (
                              <Button
                                disabled={resumingDatasetId === dataset.id}
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
                                    href={`#/search?dataset=${encodeURIComponent(dataset.id)}`}
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
                  <EmptyTitle>No datasets</EmptyTitle>
                  <EmptyDescription>
                    Index a source for fast repeated lookup, or scan files once
                    without adding them.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => inspect.mutate("files")} size="sm">
                    <FilePlus2Icon data-icon="inline-start" />
                    Choose files
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<a href="#/search?surface=direct" />}
                    size="sm"
                    variant="outline"
                  >
                    <FileSearchIcon data-icon="inline-start" />
                    Scan without indexing
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </DashboardCard>
      </div>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review import</DialogTitle>
            <DialogDescription>
              Detection previews are masked before reaching this screen.
            </DialogDescription>
          </DialogHeader>
          {inspection ? (
            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
              {largeInspection ? (
                <Alert>
                  <FileSearchIcon />
                  <AlertTitle>Live scan is faster to start</AlertTitle>
                  <AlertDescription>
                    This selection is at least 1 GB or contains an estimated 4
                    million rows. Use live scan for immediate lookup; build an
                    index only when you need repeated searches and grouping.
                  </AlertDescription>
                  <div className="col-start-2 mt-2">
                    <Button
                      nativeButton={false}
                      onClick={() => setDialogOpen(false)}
                      render={<a href="#/search?surface=direct" />}
                      size="sm"
                      variant="outline"
                    >
                      <FileSearchIcon data-icon="inline-start" />
                      Switch to live scan
                    </Button>
                  </div>
                </Alert>
              ) : null}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Encoding</TableHead>
                    <TableHead>Columns</TableHead>
                    <TableHead>Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inspection.files.map((file) => (
                    <TableRow key={file.absolutePath}>
                      <TableCell className="max-w-72 truncate">
                        {file.fileName}
                      </TableCell>
                      <TableCell>{file.format}</TableCell>
                      <TableCell>{file.encoding}</TableCell>
                      <TableCell>{file.columnCount}</TableCell>
                      <TableCell>{formatBytes(file.fileSize)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <FieldGroup>
                {(
                  [
                    [
                      "extractDomains",
                      "Group domains",
                      "Normalize domains and subdomains for lookup.",
                    ],
                    [
                      "groupIdentities",
                      "Build identities",
                      "Create automatic exact-identifier groups.",
                    ],
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
              disabled={!datasetLabel.trim() || start.isPending}
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
    </div>
  );
}
