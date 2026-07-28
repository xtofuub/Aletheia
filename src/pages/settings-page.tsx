import { useState } from "react";
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

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [confirmCleanup, setConfirmCleanup] = useState<"index" | "all" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
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
    onSuccess: async () => {
      setNotice("Security settings saved locally");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
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

  function saveSecurity(formData: FormData) {
    const input: SecuritySettingsInput = {
      clipboardClearSeconds: Number(formData.get("clipboard")),
      inactivityLockMinutes: Number(formData.get("lock")),
      workerLimit: Number(formData.get("workers")),
      memoryLimitMb: Number(formData.get("memory")),
    };
    security.mutate(input);
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
          {settings.data ? (
            <form
              className="security-form"
              action={(formData) => saveSecurity(formData)}
            >
              <label>
                <span>Clipboard clear</span>
                <select
                  name="clipboard"
                  defaultValue={settings.data.clipboardClearSeconds}
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
                  defaultValue={settings.data.inactivityLockMinutes}
                >
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                </select>
              </label>
              <label>
                <span>Worker limit</span>
                <select name="workers" defaultValue={settings.data.workerLimit}>
                  {[1, 2, 4, 6, 8].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Memory limit</span>
                <select
                  name="memory"
                  defaultValue={settings.data.memoryLimitMb}
                >
                  {[256, 512, 1024, 2048, 4096, 8192].map((value) => (
                    <option key={value} value={value}>
                      {value} MiB
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="secondary" type="submit">
                <Check size={14} />
                Save protections
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
