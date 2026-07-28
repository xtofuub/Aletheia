import { useEffect, useState } from "react";
import {
  Database,
  Keyboard,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { getSettings, getSystemStatus } from "../lib/desktop";
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

  useEffect(() => {
    if (!settings.data) return;
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
                <span>Offline</span>
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
