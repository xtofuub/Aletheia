import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Cpu,
  Gauge,
  HardDrive,
  Laptop,
  LockKeyhole,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  WifiOff,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { useTheme } from "../components/theme-provider";
import { Button } from "../components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  cleanupGenerated,
  getSettings,
  getSystemStatus,
  updateSecuritySettings,
  type SecuritySettingsInput,
  type Theme,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";

const themeOptions: Array<{
  value: Theme;
  label: string;
  description: string;
  icon: typeof Moon;
}> = [
  {
    value: "dark",
    label: "Dark",
    description: "Deep black workspace",
    icon: Moon,
  },
  {
    value: "light",
    label: "Light",
    description: "Clean neutral workspace",
    icon: Sun,
  },
  {
    value: "system",
    label: "System",
    description: "Follow Windows",
    icon: Monitor,
  },
];

function settingsToProtections(
  settings: Awaited<ReturnType<typeof getSettings>>,
): SecuritySettingsInput {
  return {
    clipboardClearSeconds: settings.clipboardClearSeconds,
    inactivityLockMinutes: settings.inactivityLockMinutes,
    workerLimit: settings.workerLimit,
    memoryLimitMb: settings.memoryLimitMb,
    automaticUpdateChecks: settings.automaticUpdateChecks,
  };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [confirmCleanup, setConfirmCleanup] = useState<"index" | "all" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [protections, setProtections] = useState<SecuritySettingsInput | null>(
    null,
  );
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
  const security = useMutation({
    mutationFn: updateSecuritySettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(["settings"], saved);
      setProtections(settingsToProtections(saved));
      setNotice("Settings saved and active");
    },
    onError: () => setNotice("Settings could not be saved"),
  });
  const cleanup = useMutation({
    mutationFn: (scope: "index" | "all") =>
      cleanupGenerated({
        index: scope === "index",
        cache: scope === "all",
        temp: scope === "all",
        searchHistory: scope === "all",
        allGenerated: scope === "all",
      }),
    onSuccess: async (_, scope) => {
      setNotice(
        scope === "all"
          ? "All generated investigation state cleared"
          : "Generated search index cleared",
      );
      setConfirmCleanup(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-status"] }),
        queryClient.invalidateQueries({ queryKey: ["datasets"] }),
      ]);
    },
  });

  const currentProtections =
    protections ??
    (settings.data ? settingsToProtections(settings.data) : null);
  const dirty =
    currentProtections &&
    settings.data &&
    JSON.stringify(currentProtections) !==
      JSON.stringify(settingsToProtections(settings.data));
  const hardwareThreads = Math.max(1, navigator.hardwareConcurrency || 1);
  const recommendedWorkers = Math.max(
    1,
    Math.min(8, Math.floor(hardwareThreads / 2)),
  );
  const totalGeneratedBytes =
    (status.data?.metadataBytes ?? 0) + (status.data?.indexBytes ?? 0);
  const allocation = currentProtections
    ? `${currentProtections.workerLimit} workers, ${formatBytes(
        currentProtections.memoryLimitMb * 1024 * 1024,
      )}`
    : "Loading";

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProtections) return;
    setNotice("");
    security.mutate(currentProtections);
  }

  function setProtection<K extends keyof SecuritySettingsInput>(
    key: K,
    value: SecuritySettingsInput[K],
  ) {
    setProtections((current) =>
      currentProtections
        ? { ...(current ?? currentProtections), [key]: value }
        : current,
    );
  }

  function applyPreset(workerLimit: number, memoryLimitMb: number) {
    if (!currentProtections) return;
    setProtections({
      ...currentProtections,
      workerLimit,
      memoryLimitMb,
    });
  }

  function requestCleanup(scope: "index" | "all") {
    if (confirmCleanup === scope) {
      cleanup.mutate(scope);
      return;
    }
    setConfirmCleanup(scope);
    setNotice(
      scope === "all"
        ? "Click again to clear generated metadata and indexes. Source files stay untouched."
        : "Click again to clear the generated search index.",
    );
  }

  return (
    <div className="page page--settings">
      <PageHeader
        title="Settings"
        description="Tune Aletheia for this computer without weakening the local privacy boundary."
        meta={dirty ? "UNSAVED CHANGES" : "ALL CHANGES LOCAL"}
        action={
          <Button
            form="settings-form"
            type="submit"
            variant="primary"
            disabled={!currentProtections || security.isPending || !dirty}
          >
            <Check />
            {security.isPending ? "Saving" : "Save changes"}
          </Button>
        }
      />

      {notice ? <p className="notice-line">{notice}</p> : null}

      <div className="settings-status-strip">
        <span>
          <ShieldCheck />
          Data workflows offline
        </span>
        <span>
          <Cpu />
          {hardwareThreads} CPU threads detected
        </span>
        <span>
          <HardDrive />
          {formatBytes(totalGeneratedBytes)} generated
        </span>
      </div>

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="Settings sections">
          <a href="#appearance">
            <Monitor />
            Appearance
          </a>
          <a href="#performance">
            <Gauge />
            Performance
          </a>
          <a href="#privacy">
            <LockKeyhole />
            Privacy
          </a>
          <a href="#storage">
            <HardDrive />
            Storage
          </a>
          <a href="#cleanup">
            <Trash2 />
            Cleanup
          </a>
          <div>
            <strong>Current allocation</strong>
            <span className="font-mono">{allocation}</span>
          </div>
        </aside>

        <form
          className="settings-content"
          id="settings-form"
          onSubmit={saveSettings}
        >
          <Card id="appearance" className="settings-card">
            <CardHeader className="border-b">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                One theme is applied consistently across every workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="theme-choice-grid" aria-label="Theme">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      data-active={theme === option.value}
                      onClick={() => void setTheme(option.value)}
                    >
                      <Icon />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                      {theme === option.value ? <Check /> : null}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card id="performance" className="settings-card">
            <CardHeader className="border-b">
              <CardTitle>Indexing performance</CardTitle>
              <CardDescription>
                Workers use CPU. Memory reduces index flushes and disk pressure.
              </CardDescription>
              <CardAction>
                <span className="settings-card__value font-mono">
                  {allocation}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="resource-presets">
                <button type="button" onClick={() => applyPreset(2, 512)}>
                  <Laptop />
                  <span>
                    <strong>Responsive</strong>
                    <small>2 workers, 512 MiB</small>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(recommendedWorkers, 1024)}
                >
                  <Gauge />
                  <span>
                    <strong>Balanced</strong>
                    <small>{recommendedWorkers} workers, 1 GiB</small>
                  </span>
                </button>
                <button type="button" onClick={() => applyPreset(8, 4096)}>
                  <Cpu />
                  <span>
                    <strong>Maximum</strong>
                    <small>8 workers, 4 GiB</small>
                  </span>
                </button>
              </div>
              {currentProtections ? (
                <div className="resource-fields">
                  <label>
                    <span>Index workers</span>
                    <select
                      aria-label="Index workers"
                      value={currentProtections.workerLimit}
                      onChange={(event) =>
                        setProtection("workerLimit", Number(event.target.value))
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <small>
                      More workers can improve CPU-heavy indexing. Slow storage
                      can become the limit first.
                    </small>
                  </label>
                  <label>
                    <span>Index memory budget</span>
                    <select
                      aria-label="Index memory budget"
                      value={currentProtections.memoryLimitMb}
                      onChange={(event) =>
                        setProtection(
                          "memoryLimitMb",
                          Number(event.target.value),
                        )
                      }
                    >
                      {[256, 512, 1024, 2048, 4096].map((value) => (
                        <option key={value} value={value}>
                          {value} MiB
                        </option>
                      ))}
                    </select>
                    <small>
                      This is a ceiling for the Tantivy writer and import
                      buffers, not a reserved allocation.
                    </small>
                  </label>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card id="privacy" className="settings-card">
            <CardHeader className="border-b">
              <CardTitle>Privacy protections</CardTitle>
              <CardDescription>
                Control temporary access and optional release notifications.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentProtections ? (
                <div className="privacy-settings">
                  <label>
                    <span>
                      <strong>Clipboard clear</strong>
                      <small>
                        Remove copied sensitive values automatically.
                      </small>
                    </span>
                    <select
                      aria-label="Clipboard clear"
                      value={currentProtections.clipboardClearSeconds}
                      onChange={(event) =>
                        setProtection(
                          "clipboardClearSeconds",
                          Number(event.target.value),
                        )
                      }
                    >
                      <option value={30}>30 seconds</option>
                      <option value={60}>60 seconds</option>
                      <option value={120}>2 minutes</option>
                      <option value={300}>5 minutes</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      <strong>Inactivity lock</strong>
                      <small>Lock the interface after no interaction.</small>
                    </span>
                    <select
                      aria-label="Inactivity lock"
                      value={currentProtections.inactivityLockMinutes}
                      onChange={(event) =>
                        setProtection(
                          "inactivityLockMinutes",
                          Number(event.target.value),
                        )
                      }
                    >
                      <option value={0}>Disabled</option>
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </label>
                  <label className="settings-toggle">
                    <span>
                      <strong>Check GitHub for updates</strong>
                      <small>
                        Sends only a version request. Dataset details are never
                        included.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={currentProtections.automaticUpdateChecks}
                      onChange={(event) =>
                        setProtection(
                          "automaticUpdateChecks",
                          event.target.checked,
                        )
                      }
                    />
                  </label>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="settings-card-grid">
            <Card id="storage" className="settings-card" size="sm">
              <CardHeader className="border-b">
                <CardTitle>Local storage</CardTitle>
                <CardDescription>
                  Generated metadata and indexes only.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="settings-facts">
                  <div>
                    <dt>Location</dt>
                    <dd className="font-mono">
                      {status.data?.storageRoot ?? "Loading"}
                    </dd>
                  </div>
                  <div>
                    <dt>Metadata</dt>
                    <dd className="font-mono">
                      {formatBytes(status.data?.metadataBytes ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>Search index</dt>
                    <dd className="font-mono">
                      {formatBytes(status.data?.indexBytes ?? 0)}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card className="settings-card" size="sm">
              <CardHeader className="border-b">
                <CardTitle>Network boundary</CardTitle>
                <CardDescription>
                  Dataset workflows have no outbound path.
                </CardDescription>
              </CardHeader>
              <CardContent className="network-boundary">
                <WifiOff />
                <div>
                  <strong>Data stays on this device</strong>
                  <span>
                    Only the optional GitHub version check can use the network.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card id="cleanup" className="settings-card settings-danger">
            <CardHeader className="border-b">
              <CardTitle>Generated data cleanup</CardTitle>
              <CardDescription>
                Source files are outside every cleanup action.
              </CardDescription>
              <CardAction>
                <Trash2 />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="cleanup-actions">
                <Button
                  type="button"
                  variant="danger"
                  disabled={cleanup.isPending}
                  onClick={() => requestCleanup("index")}
                >
                  {confirmCleanup === "index"
                    ? "Confirm clear index"
                    : "Clear generated index"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={cleanup.isPending}
                  onClick={() => requestCleanup("all")}
                >
                  {confirmCleanup === "all"
                    ? "Confirm clear all"
                    : "Clear all generated state"}
                </Button>
              </div>
            </CardContent>
            <CardFooter>
              <span>
                Cleanup is local and cannot delete the original selected
                datasets.
              </span>
            </CardFooter>
          </Card>

          <div className="settings-save-bar">
            <span>
              {dirty
                ? "You have unsaved settings."
                : "All settings are saved locally."}
            </span>
            {dirty && settings.data ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setProtections(settingsToProtections(settings.data))
                }
              >
                <RefreshCw />
                Reset
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              disabled={!currentProtections || security.isPending || !dirty}
            >
              <Check />
              {security.isPending ? "Saving" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
