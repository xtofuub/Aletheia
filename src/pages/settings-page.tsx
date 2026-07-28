import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  HardDrive,
  LockKeyhole,
  MonitorCog,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { useTheme } from "../components/theme-provider";
import { Button } from "../components/ui/button";
import {
  cleanupGenerated,
  getSettings,
  getSystemStatus,
  updateSecuritySettings,
  type SecuritySettingsInput,
  type Theme,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";

const themeOptions: Array<{ value: Theme; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
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
      setNotice("Resource protections saved and active");
    },
    onError: () => setNotice("Resource protections could not be saved"),
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

  function saveSecurity(event: FormEvent<HTMLFormElement>) {
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

  function requestCleanup(scope: "index" | "all") {
    if (confirmCleanup === scope) {
      cleanup.mutate(scope);
    } else {
      setConfirmCleanup(scope);
      setNotice(
        scope === "all"
          ? "Confirm again to clear generated metadata and indexes. Source files are never touched."
          : "Confirm again to clear the generated search index.",
      );
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        description="Control appearance, local storage, sensitive-field handling, and generated data."
      />

      {notice ? <p className="notice-line">{notice}</p> : null}

      <div className="settings-grid">
        <section className="settings-section">
          <div className="settings-section__heading">
            <MonitorCog size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h2>Appearance</h2>
              <p>Theme changes never affect indexed content.</p>
            </div>
          </div>
          <div className="segmented-control" aria-label="Theme">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                data-active={theme === option.value}
                onClick={() => void setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <HardDrive size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h2>Local storage</h2>
              <p>Generated metadata and index files.</p>
            </div>
          </div>
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
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <WifiOff size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h2>Network boundary</h2>
              <p>Core features have no outbound data path.</p>
            </div>
          </div>
          <div className="setting-state">
            <span>Network access</span>
            <strong>
              <ShieldCheck size={14} />
              Disabled for data workflows
            </strong>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h2>Resource protections</h2>
              <p>Bounds for local sensitive work.</p>
            </div>
          </div>
          {currentProtections ? (
            <form className="security-form" onSubmit={saveSecurity}>
              <label>
                <span>Clipboard clear</span>
                <select
                  name="clipboard"
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
                <span>Inactivity lock</span>
                <select
                  name="lock"
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
              <label>
                <span>Index workers</span>
                <select
                  name="workers"
                  value={currentProtections.workerLimit}
                  onChange={(event) =>
                    setProtection("workerLimit", Number(event.target.value))
                  }
                >
                  {[1, 2, 4, 6, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <small>
                  Threads used by one import. More can help CPU-heavy indexing,
                  but can hurt on a slow drive.
                </small>
              </label>
              <label>
                <span>Index memory budget</span>
                <select
                  name="memory"
                  value={currentProtections.memoryLimitMb}
                  onChange={(event) =>
                    setProtection("memoryLimitMb", Number(event.target.value))
                  }
                >
                  {[256, 512, 1024, 2048, 4096].map((value) => (
                    <option key={value} value={value}>
                      {value} MiB
                    </option>
                  ))}
                </select>
                <small>
                  Per-import ceiling. More memory reduces index flushes; it
                  cannot overcome disk or SQLite bottlenecks.
                </small>
              </label>
              <label className="security-form__toggle">
                <input
                  type="checkbox"
                  checked={currentProtections.automaticUpdateChecks}
                  onChange={(event) =>
                    setProtection("automaticUpdateChecks", event.target.checked)
                  }
                />
                <span>
                  Check GitHub for updates
                  <small>
                    Sends only the app version request. Dataset information is
                    never included.
                  </small>
                </span>
              </label>
              <Button
                size="sm"
                variant="secondary"
                type="submit"
                disabled={security.isPending}
              >
                <Check size={14} />
                {security.isPending ? "Saving" : "Save protections"}
              </Button>
            </form>
          ) : null}
        </section>

        <section className="settings-section settings-section--danger">
          <div className="settings-section__heading">
            <LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h2>Generated data cleanup</h2>
              <p>Source files are outside every cleanup action.</p>
            </div>
          </div>
          <div className="cleanup-actions">
            <Button
              variant="danger"
              disabled={cleanup.isPending}
              onClick={() => requestCleanup("index")}
            >
              {confirmCleanup === "index"
                ? "Confirm clear index"
                : "Clear generated index"}
            </Button>
            <Button
              variant="danger"
              disabled={cleanup.isPending}
              onClick={() => requestCleanup("all")}
            >
              {confirmCleanup === "all"
                ? "Confirm clear all"
                : "Clear all generated state"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
