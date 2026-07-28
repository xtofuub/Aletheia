import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  BookMarked,
  Boxes,
  CircleGauge,
  Database,
  Download,
  FolderSearch,
  Globe2,
  IdCard,
  Keyboard,
  LockKeyhole,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { getSettings, getSystemStatus } from "../lib/desktop";
import { formatBytes } from "../lib/utils";
import { CommandPalette } from "./command-palette";
import { Button } from "./ui/button";

const navItems = [
  { to: "/", label: "Overview", icon: CircleGauge },
  { to: "/search", label: "Search", icon: Search },
  { to: "/identities", label: "Identities", icon: IdCard },
  { to: "/domains", label: "Domains", icon: Globe2 },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/saved-views", label: "Saved Views", icon: BookMarked },
  { to: "/exports", label: "Exports", icon: Download },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const routeNames: Record<string, string> = {
  "/": "Overview",
  "/search": "Search",
  "/identities": "Identities",
  "/domains": "Domains",
  "/datasets": "Datasets",
  "/saved-views": "Saved Views",
  "/exports": "Exports",
  "/settings": "Settings",
};

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
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

  const title = useMemo(() => routeNames[pathname] ?? "Aletheia", [pathname]);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link to="/" className="brand-lockup brand-lockup--sidebar">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <span>Aletheia</span>
        </Link>

        <nav className="sidebar-nav" aria-label="Primary">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-link"
              activeProps={{ "data-active": true }}
              activeOptions={{ exact: item.to === "/" }}
            >
              <item.icon size={17} strokeWidth={1.55} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-trust">
          <ShieldCheck size={17} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>Local trust boundary</strong>
            <span>No data transmitted</span>
          </div>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="topbar">
          <div className="topbar__route">
            <span className="topbar__rail" aria-hidden="true" />
            <span>{title}</span>
          </div>
          <button
            className="global-search-trigger"
            onClick={() => void navigate({ to: "/search" })}
          >
            <FolderSearch size={16} strokeWidth={1.6} aria-hidden="true" />
            <span>Search local index</span>
            <kbd>/</kbd>
          </button>
          <div className="topbar__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaletteOpen(true)}
            >
              <Keyboard size={15} aria-hidden="true" />
              Commands
              <kbd className="keycap">Ctrl K</kbd>
            </Button>
          </div>
        </header>

        <main className="route-workspace">
          <Outlet />
        </main>

        <footer className="status-strip">
          <div>
            <ShieldCheck size={13} strokeWidth={1.7} aria-hidden="true" />
            <span>Offline</span>
            <span className="status-strip__secondary">No data transmitted</span>
          </div>
          <div>
            <Boxes size={13} strokeWidth={1.7} aria-hidden="true" />
            <span>Index {formatBytes(status.data?.indexBytes ?? 0)}</span>
          </div>
          <div>
            <ArchiveRestore size={13} strokeWidth={1.7} aria-hidden="true" />
            <span>Tasks clear</span>
          </div>
        </footer>
      </div>

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
    </div>
  );
}
