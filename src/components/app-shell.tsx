import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Database,
  Keyboard,
  LockKeyhole,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  checkForUpdates,
  getSettings,
  getSystemStatus,
  openReleasePage,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";
import { CommandPalette } from "./command-palette";
import { AppSidebar } from "./shadcn-dashboard/blocks/sidebar/sidebar-01/app-sidebar";
import { Button } from "./ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";
import appIcon from "../assets/app-icon.svg";

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dismissedUpdate, setDismissedUpdate] = useState(() =>
    window.localStorage.getItem("aletheia.dismissed-update"),
  );
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
    refetchInterval: 30_000,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
  const update = useQuery({
    queryKey: ["update-check"],
    queryFn: checkForUpdates,
    enabled: settings.data?.automaticUpdateChecks === true,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const availableUpdate =
    update.data?.updateAvailable &&
    update.data.latestVersion !== dismissedUpdate
      ? update.data
      : null;

  function dismissUpdate() {
    if (!availableUpdate) return;
    window.localStorage.setItem(
      "aletheia.dismissed-update",
      availableUpdate.latestVersion,
    );
    setDismissedUpdate(availableUpdate.latestVersion);
  }

  useEffect(() => {
    if (!settings.data) return;
    if (settings.data.inactivityLockMinutes === 0) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      if (timer) clearTimeout(timer);
      if (!locked) {
        timer = setTimeout(
          () => setLocked(true),
          settings.data.inactivityLockMinutes * 60_000,
        );
      }
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((eventName) =>
      window.addEventListener(eventName, reset, { passive: true }),
    );
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((eventName) =>
        window.removeEventListener(eventName, reset),
      );
    };
  }, [locked, settings.data]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
      if (!typing && event.key === "/") {
        event.preventDefault();
        void navigate({ to: "/search" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <TooltipProvider>
      <SidebarProvider
        className="aletheia-shell"
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3.5rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset className="min-h-svh min-w-0 overflow-hidden rounded-none bg-background shadow-none">
          <header className="dashboard-topbar">
            <div className="dashboard-topbar__left">
              <SidebarTrigger
                className="size-8 rounded-md border-0"
                aria-label="Toggle navigation"
              />
              <span className="dashboard-topbar__divider" aria-hidden="true" />
              <button
                className="dashboard-search-trigger"
                onClick={() => void navigate({ to: "/search" })}
                aria-label="Search the local index"
              >
                <Search aria-hidden="true" />
                <span>Search local index</span>
                <kbd>/</kbd>
              </button>
            </div>
            <div className="dashboard-topbar__right">
              <div className="topbar-status" title="No data is transmitted">
                <ShieldCheck aria-hidden="true" />
                <span>Data local</span>
              </div>
              <div className="topbar-index" title="Local index storage">
                <Database aria-hidden="true" />
                <span>{formatBytes(status.data?.indexBytes ?? 0)}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="topbar-command"
                onClick={() => setPaletteOpen(true)}
              >
                <Keyboard aria-hidden="true" />
                <span>Commands</span>
                <kbd>Ctrl K</kbd>
              </Button>
              <span
                className="topbar-avatar"
                aria-label="Local Aletheia profile"
              >
                <img src={appIcon} alt="" aria-hidden="true" />
              </span>
            </div>
          </header>

          <main className="route-workspace">
            <Outlet />
          </main>
        </SidebarInset>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        {availableUpdate ? (
          <aside className="update-notice" role="status" aria-live="polite">
            <button
              className="update-notice__close"
              aria-label="Dismiss update"
              onClick={dismissUpdate}
            >
              <X size={14} />
            </button>
            <span className="eyebrow">UPDATE AVAILABLE</span>
            <strong>Aletheia {availableUpdate.latestVersion}</strong>
            <p>
              A newer Windows release is ready. Your local workspace is not
              included in this check.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void openReleasePage(availableUpdate.releaseUrl)}
            >
              View release
              <ArrowUpRight size={14} />
            </Button>
          </aside>
        ) : null}
        {locked ? (
          <div className="privacy-lock" role="dialog" aria-modal="true">
            <div>
              <LockKeyhole size={24} />
              <span className="eyebrow">LOCAL PRIVACY LOCK</span>
              <h2>Workspace hidden after inactivity</h2>
              <p>
                No job or source was changed. Unlock to return to the local
                workspace.
              </p>
              <Button variant="primary" onClick={() => setLocked(false)}>
                Unlock local workspace
              </Button>
            </div>
          </div>
        ) : null}
      </SidebarProvider>
    </TooltipProvider>
  );
}
