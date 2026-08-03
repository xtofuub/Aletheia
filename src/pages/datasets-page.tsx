import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FilePlus2Icon,
  FileSearchIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  UploadIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
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
      setInspection(result);
      setDatasetLabel(
        result.files[0]?.fileName.replace(/\.[^.]+$/, "") ??
          "Authorized dataset",
      );
      setDialogOpen(true);
    },
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
  });

  const active =
    progress &&
    ["queued", "running", "paused", "cancelling"].includes(progress.status);
  const percent = progress?.totalBytes
    ? Math.min(100, (progress.bytesRead / progress.totalBytes) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        actions={
          <>
            <Button
              disabled={inspect.isPending}
              onClick={() => inspect.mutate("folder")}
              size="sm"
              variant="outline"
            >
              <FolderOpenIcon data-icon="inline-start" />
              Add folder
            </Button>
            <Button
              disabled={inspect.isPending}
              onClick={() => inspect.mutate("files")}
              size="sm"
            >
              <FilePlus2Icon data-icon="inline-start" />
              Add files
            </Button>
          </>
        }
        description="Add local sources for fast, repeatable search. Original files stay unchanged."
        title="Datasets"
      />

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
                          {resumable ? (
                            <Button
                              onClick={() =>
                                void resumeDatasetImport(dataset.id).then(
                                  (result) =>
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
                                    }),
                                )
                              }
                              size="sm"
                              variant="outline"
                            >
                              <RotateCcwIcon data-icon="inline-start" />
                              Resume
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
              <UploadIcon data-icon="inline-start" />
              Start import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
