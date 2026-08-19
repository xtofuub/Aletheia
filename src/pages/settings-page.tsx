import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CpuIcon,
  DatabaseIcon,
  DownloadIcon,
  GaugeIcon,
  HardDriveIcon,
  LockKeyholeIcon,
  MemoryStickIcon,
  PaletteIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

import { applyTheme } from "@/theme-provider";
import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
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
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  checkForUpdates,
  cleanupGenerated,
  downloadAndInstallUpdate,
  getSettings,
  getPerformanceProfile,
  getSystemStatus,
  openReleasePage,
  runPerformanceBenchmark,
  saveOnboarding,
  selectStorageFolder,
  updateSecuritySettings,
  updateTheme,
  type Settings,
  type Theme,
  type UpdateInstallProgress,
} from "@/lib/desktop";
import {
  formatBytes,
  formatDateTime,
  formatPathForDisplay,
} from "@/lib/format";

const themeItems = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const workerItems = [1, 2, 4, 6, 8].map((value) => ({
  label: `${value} workers`,
  value: String(value),
}));
const memoryItems = [256, 512, 1024, 2048, 4096].map((value) => ({
  label: `${value} MB`,
  value: String(value),
}));
const inactivityItems = [
  { label: "Disabled", value: "0" },
  { label: "5 minutes", value: "5" },
  { label: "15 minutes", value: "15" },
  { label: "30 minutes", value: "30" },
  { label: "60 minutes", value: "60" },
];
const clipboardItems = [15, 30, 60, 120, 300, 600].map((value) => ({
  label: `${value} seconds`,
  value: String(value),
}));
const updateProgressLabels: Record<UpdateInstallProgress["state"], string> = {
  checking: "Checking signed release",
  downloading: "Downloading update",
  installing: "Installing update",
  restarting: "Restarting Aletheia",
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
  const system = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
  });
  const performanceProfile = useQuery({
    queryKey: ["performance-profile"],
    queryFn: getPerformanceProfile,
  });
  const update = useQuery({
    queryKey: ["update-status"],
    queryFn: checkForUpdates,
    enabled: false,
  });
  const [formOverride, setForm] = useState<Settings | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingStorageRoot, setPendingStorageRoot] = useState<string | null>(
    null,
  );
  const [installProgress, setInstallProgress] =
    useState<UpdateInstallProgress | null>(null);

  const form = formOverride ?? settingsQuery.data ?? null;

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Settings are not ready.");
      return updateSecuritySettings({
        clipboardClearSeconds: form.clipboardClearSeconds,
        inactivityLockMinutes: form.inactivityLockMinutes,
        workerLimit: form.workerLimit,
        memoryLimitMb: form.memoryLimitMb,
        automaticUpdateChecks: form.automaticUpdateChecks,
      });
    },
    onSuccess: (next) => {
      setForm(next);
      queryClient.setQueryData(["settings"], next);
      setNotice("Settings saved");
    },
  });

  const benchmark = useMutation({
    mutationFn: runPerformanceBenchmark,
    onSuccess: (profile) => {
      queryClient.setQueryData(["performance-profile"], profile);
      setNotice("Device benchmark complete");
    },
    onError: (error) => setNotice(`Benchmark failed: ${String(error)}`),
  });

  const installUpdate = useMutation({
    mutationFn: () => downloadAndInstallUpdate(setInstallProgress),
    onSuccess: (started) => {
      if (!started) {
        setInstallProgress(null);
        setNotice("No signed update is currently available");
      }
    },
    onError: () => {
      setInstallProgress(null);
      setNotice("Update failed; the current installation is unchanged");
    },
  });

  const switchWorkspace = useMutation({
    mutationFn: (storageRoot: string) =>
      saveOnboarding({
        authorizationConfirmed: true,
        storageRoot,
      }),
    onSuccess: async (next) => {
      setForm(next);
      setPendingStorageRoot(null);
      setNotice("Workspace switched");
      queryClient.setQueryData(["settings"], next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-status"] }),
        queryClient.invalidateQueries({ queryKey: ["datasets"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
      ]);
    },
    onError: (error) => setNotice(`Workspace switch failed: ${String(error)}`),
  });

  async function changeTheme(theme: Theme) {
    if (!form) return;
    const previous = form;
    const next = { ...form, theme };
    setForm(next);
    applyTheme(theme);
    try {
      await updateTheme(theme);
      queryClient.setQueryData(["settings"], next);
      setNotice("Theme updated");
    } catch {
      setForm(previous);
      applyTheme(previous.theme);
    }
  }

  async function runCleanup(kind: "cache" | "history" | "all") {
    await cleanupGenerated({
      cache: kind === "cache",
      index: false,
      temp: kind === "cache",
      searchHistory: kind === "history",
      allGenerated: kind === "all",
    });
    setNotice("Cleanup complete");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-status"] }),
      queryClient.invalidateQueries({ queryKey: ["datasets"] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] }),
    ]);
  }

  if (!form) return null;

  const updatePercent = installProgress?.totalBytes
    ? Math.min(
        100,
        (installProgress.downloadedBytes / installProgress.totalBytes) * 100,
      )
    : 0;

  return (
    <div>
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            {notice ? <Badge variant="outline">{notice}</Badge> : null}
            <Button
              disabled={save.isPending}
              onClick={() => save.mutate()}
              size="sm"
            >
              {save.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SaveIcon data-icon="inline-start" />
              )}
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
        description="One place for appearance, indexing resources, privacy, storage, and updates."
        title="Settings"
      />

      <div className="grid grid-cols-1 gap-px bg-border p-px xl:grid-cols-12">
        <DashboardCard className="xl:col-span-4">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose the workspace theme.</CardDescription>
            <CardAction>
              <PaletteIcon />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Theme</FieldTitle>
                  <FieldDescription>Applied immediately.</FieldDescription>
                </FieldContent>
                <Select
                  items={themeItems}
                  onValueChange={(value) => void changeTheme(value as Theme)}
                  value={form.theme}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {themeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
        </DashboardCard>

        <DashboardCard className="xl:col-span-8">
          <CardHeader>
            <CardTitle>Indexing resources</CardTitle>
            <CardDescription>
              Higher budgets can improve throughput when storage can keep up.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">
                {form.workerLimit} workers · {form.memoryLimitMb} MB
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Worker limit</FieldTitle>
                  <FieldDescription>
                    CPU workers for indexing and Live matching. Live source
                    reading stays sequential on HDDs, so extra workers help only
                    when matching is the bottleneck.
                  </FieldDescription>
                </FieldContent>
                <Select
                  items={workerItems}
                  onValueChange={(value) =>
                    setForm((current) =>
                      current
                        ? { ...current, workerLimit: Number(value) }
                        : current,
                    )
                  }
                  value={String(form.workerLimit)}
                >
                  <SelectTrigger>
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
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Memory limit</FieldTitle>
                  <FieldDescription>
                    Import and writer budget. More memory reduces index flushes,
                    but source and metadata I/O can still be the bottleneck.
                  </FieldDescription>
                </FieldContent>
                <Select
                  items={memoryItems}
                  onValueChange={(value) =>
                    setForm((current) =>
                      current
                        ? { ...current, memoryLimitMb: Number(value) }
                        : current,
                    )
                  }
                  value={String(form.memoryLimitMb)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {memoryItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
        </DashboardCard>

        <DashboardCard className="xl:col-span-12">
          <CardHeader>
            <CardTitle>Device benchmark</CardTitle>
            <CardDescription>
              Measures workspace I/O, CPU matching, memory copying, and archive
              decompression using generated temporary data.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">
                {performanceProfile.data?.storageClass ?? "Not measured"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {performanceProfile.data ? (
              <>
                <div className="grid grid-cols-2 gap-px bg-border p-px md:grid-cols-5">
                  {[
                    [
                      "Workspace read",
                      `${formatBytes(performanceProfile.data.diskReadBytesPerSecond)}/s`,
                    ],
                    [
                      "Workspace write",
                      `${formatBytes(performanceProfile.data.diskWriteBytesPerSecond)}/s`,
                    ],
                    [
                      "CPU matching",
                      `${formatBytes(performanceProfile.data.cpuScanBytesPerSecond)}/s`,
                    ],
                    [
                      "Memory copy",
                      `${formatBytes(performanceProfile.data.memoryCopyBytesPerSecond)}/s`,
                    ],
                    [
                      "Archive decode",
                      `${formatBytes(performanceProfile.data.archiveBytesPerSecond)}/s`,
                    ],
                  ].map(([label, value]) => (
                    <div className="bg-background p-3" key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 font-mono text-sm tabular-nums">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <Alert>
                  <CpuIcon />
                  <AlertTitle>
                    Recommended:{" "}
                    {performanceProfile.data.recommendedWorkerLimit} workers ·{" "}
                    {performanceProfile.data.recommendedMemoryLimitMb} MB
                  </AlertTitle>
                  <AlertDescription>
                    {performanceProfile.data.recommendationReason} Available
                    memory:{" "}
                    {formatBytes(performanceProfile.data.availableMemoryBytes)}{" "}
                    of {formatBytes(performanceProfile.data.totalMemoryBytes)}.
                  </AlertDescription>
                </Alert>
                <p className="text-xs text-muted-foreground">
                  Measured {formatDateTime(performanceProfile.data.measuredAt)}.
                  Source drives are sampled separately before each Live scan.
                </p>
              </>
            ) : (
              <Alert>
                <MemoryStickIcon />
                <AlertTitle>No device profile yet</AlertTitle>
                <AlertDescription>
                  Run the local benchmark to replace generic resource defaults
                  with recommendations for this computer.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex-wrap justify-end gap-2 rounded-none bg-background">
            {performanceProfile.data ? (
              <Button
                onClick={() => {
                  const profile = performanceProfile.data;
                  if (!profile) return;
                  setForm((current) =>
                    current
                      ? {
                          ...current,
                          workerLimit: profile.recommendedWorkerLimit,
                          memoryLimitMb: profile.recommendedMemoryLimitMb,
                        }
                      : current,
                  );
                  setNotice("Recommended resources selected; save to apply");
                }}
                size="sm"
                variant="outline"
              >
                <GaugeIcon data-icon="inline-start" />
                Use recommendation
              </Button>
            ) : null}
            <Button
              disabled={benchmark.isPending}
              onClick={() => benchmark.mutate()}
              size="sm"
            >
              {benchmark.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CpuIcon data-icon="inline-start" />
              )}
              {benchmark.isPending
                ? "Benchmarking device…"
                : performanceProfile.data
                  ? "Run again"
                  : "Run benchmark"}
            </Button>
          </CardFooter>
        </DashboardCard>

        <DashboardCard className="xl:col-span-7">
          <CardHeader>
            <CardTitle>Privacy controls</CardTitle>
            <CardDescription>
              Device-local safeguards for unattended access and copied values.
            </CardDescription>
            <CardAction>
              <LockKeyholeIcon />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Inactivity lock</FieldTitle>
                  <FieldDescription>
                    Disable it or lock after a period of inactivity.
                  </FieldDescription>
                </FieldContent>
                <Select
                  items={inactivityItems}
                  onValueChange={(value) =>
                    setForm((current) =>
                      current
                        ? {
                            ...current,
                            inactivityLockMinutes: Number(value),
                          }
                        : current,
                    )
                  }
                  value={String(form.inactivityLockMinutes)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {inactivityItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Clipboard clearing</FieldTitle>
                  <FieldDescription>
                    Clear copied values after this delay.
                  </FieldDescription>
                </FieldContent>
                <Select
                  items={clipboardItems}
                  onValueChange={(value) =>
                    setForm((current) =>
                      current
                        ? {
                            ...current,
                            clipboardClearSeconds: Number(value),
                          }
                        : current,
                    )
                  }
                  value={String(form.clipboardClearSeconds)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {clipboardItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Automatic update checks</FieldTitle>
                  <FieldDescription>
                    Check release metadata without sending dataset information.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={form.automaticUpdateChecks}
                  onCheckedChange={(checked) =>
                    setForm((current) =>
                      current
                        ? { ...current, automaticUpdateChecks: checked }
                        : current,
                    )
                  }
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </DashboardCard>

        <DashboardCard className="xl:col-span-5">
          <CardHeader>
            <CardTitle>Local boundary</CardTitle>
            <CardDescription>
              Evidence parsing and search stay on this device.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">Offline evidence</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-px bg-border p-px">
            <div className="bg-background p-4">
              <GaugeIcon />
              <p className="mt-3 text-xs text-muted-foreground">Workers</p>
              <p className="font-mono text-xl tabular-nums">
                {form.workerLimit}
              </p>
            </div>
            <div className="bg-background p-4">
              <DatabaseIcon />
              <p className="mt-3 text-xs text-muted-foreground">Memory</p>
              <p className="font-mono text-xl tabular-nums">
                {form.memoryLimitMb} MB
              </p>
            </div>
          </CardContent>
        </DashboardCard>

        <DashboardCard className="xl:col-span-7">
          <CardHeader>
            <CardTitle>Generated storage</CardTitle>
            <CardDescription>
              SQLite metadata, Tantivy indexes, cache, and temporary files.
            </CardDescription>
            <CardAction>
              <HardDriveIcon />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Storage root</p>
              <p className="mt-1 break-all font-mono text-xs">
                {formatPathForDisplay(
                  system.data?.storageRoot ?? form.storageRoot,
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border p-px">
              <div className="bg-background p-3">
                <p className="text-xs text-muted-foreground">Metadata</p>
                <p className="mt-1 font-mono text-sm tabular-nums">
                  {formatBytes(system.data?.metadataBytes ?? 0)}
                </p>
              </div>
              <div className="bg-background p-3">
                <p className="text-xs text-muted-foreground">Index</p>
                <p className="mt-1 font-mono text-sm tabular-nums">
                  {formatBytes(system.data?.indexBytes ?? 0)}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="rounded-none bg-background">
            <Button
              disabled={switchWorkspace.isPending}
              onClick={() =>
                void selectStorageFolder(form.storageRoot).then(
                  (storageRoot) => {
                    if (storageRoot !== form.storageRoot) {
                      setPendingStorageRoot(storageRoot);
                    }
                  },
                )
              }
              size="sm"
              variant="outline"
            >
              {switchWorkspace.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HardDriveIcon data-icon="inline-start" />
              )}
              {switchWorkspace.isPending
                ? "Switching workspace…"
                : "Open or switch workspace"}
            </Button>
          </CardFooter>
        </DashboardCard>

        <DashboardCard className="xl:col-span-5">
          <CardHeader>
            <CardTitle>Cleanup</CardTitle>
            <CardDescription>
              Source datasets are never deleted by these actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              onClick={() => void runCleanup("history")}
              size="sm"
              variant="outline"
            >
              Clear search history
            </Button>
            <Button
              onClick={() => void runCleanup("cache")}
              size="sm"
              variant="outline"
            >
              Clear cache and temporary files
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button size="sm" variant="destructive" />}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete generated workspace
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <Trash2Icon />
                  </AlertDialogMedia>
                  <AlertDialogTitle>
                    Delete generated workspace?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes Aletheia metadata, indexes, cache, and history.
                    Original source files stay untouched.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void runCleanup("all")}
                    variant="destructive"
                  >
                    Delete generated data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </DashboardCard>

        <DashboardCard className="xl:col-span-12">
          <CardHeader>
            <CardTitle>Application update</CardTitle>
            <CardDescription>
              Installed version {system.data?.appVersion ?? "unknown"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">
                {update.data?.latestVersion ?? "Not checked"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {installProgress ? (
              <Progress value={updatePercent}>
                <ProgressLabel>
                  {updateProgressLabels[installProgress.state]}
                </ProgressLabel>
                <ProgressValue>
                  {() =>
                    installProgress.totalBytes
                      ? `${updatePercent.toFixed(0)}%`
                      : installProgress.state === "restarting"
                        ? "Ready"
                        : "Working"
                  }
                </ProgressValue>
              </Progress>
            ) : update.isError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Update check failed</AlertTitle>
                <AlertDescription>
                  GitHub or the signed update manifest could not be reached.
                  Your current installation is unchanged.
                </AlertDescription>
              </Alert>
            ) : update.data ? (
              <p className="text-sm text-muted-foreground">
                {update.data.updateAvailable
                  ? `Version ${update.data.latestVersion} is ready to install.`
                  : "Aletheia is up to date."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Automatic checks run after startup when enabled. Updates are
                downloaded only after you approve them.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-wrap justify-end gap-2 rounded-none bg-background">
            <Button
              disabled={update.isFetching || installUpdate.isPending}
              onClick={() => void update.refetch()}
              size="sm"
              variant="outline"
            >
              {update.isFetching ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {update.isFetching ? "Checking…" : "Check now"}
            </Button>
            {update.data?.releaseUrl ? (
              <Button
                onClick={() => void openReleasePage(update.data.releaseUrl)}
                size="sm"
                variant="ghost"
              >
                Release notes
              </Button>
            ) : null}
            {update.data?.updateAvailable ? (
              <Button
                disabled={installUpdate.isPending}
                onClick={() => installUpdate.mutate()}
                size="sm"
              >
                {installUpdate.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <DownloadIcon data-icon="inline-start" />
                )}
                {installUpdate.isPending ? "Updating…" : "Update and restart"}
              </Button>
            ) : null}
          </CardFooter>
        </DashboardCard>
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !switchWorkspace.isPending) setPendingStorageRoot(null);
        }}
        open={Boolean(pendingStorageRoot)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <HardDriveIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Open this Aletheia workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Indexed datasets stay in the current workspace and are not moved
              or deleted. Select their original workspace to reconnect them, or
              choose an empty folder to start a separate workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingStorageRoot ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {pendingStorageRoot}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current workspace</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingStorageRoot) {
                  switchWorkspace.mutate(pendingStorageRoot);
                }
              }}
            >
              Open workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
