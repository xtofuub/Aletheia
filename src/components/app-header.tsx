import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Maximize2Icon,
  MinusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import type { RouteKey } from "@/router";
import { navLinks } from "@/components/app-shared";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { DecorIcon } from "@/components/decor-icon";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function AppHeader({ activeRoute }: { activeRoute: RouteKey }) {
  const activeItem = navLinks.find((item) => item.route === activeRoute);

  function runWindowAction(action: "minimize" | "maximize" | "close") {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") void appWindow.minimize();
    if (action === "maximize") void appWindow.toggleMaximize();
    if (action === "close") void appWindow.close();
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between gap-2 border-b ps-4 md:ps-6",
        "bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/50",
      )}
      data-tauri-drag-region
    >
      <DecorIcon className="hidden md:block" position="bottom-left" />
      <div className="flex items-center gap-3">
        <CustomSidebarTrigger />
        <Separator orientation="vertical" />
        <AppBreadcrumbs page={activeItem ?? null} />
      </div>
      <div
        className="min-w-8 flex-1 self-stretch"
        data-tauri-drag-region
        onDoubleClick={() => runWindowAction("maximize")}
      />
      <div className="flex h-full items-center gap-2">
        <Button
          aria-label="Open search"
          nativeButton={false}
          render={<a href="#/search" />}
          size="icon-sm"
          variant="outline"
        >
          <SearchIcon />
        </Button>
        <Separator orientation="vertical" />
        <NavUser />
        <Separator orientation="vertical" />
        <div className="flex h-full items-center">
          <Button
            aria-label="Minimize window"
            onClick={() => runWindowAction("minimize")}
            size="icon-sm"
            variant="ghost"
          >
            <MinusIcon />
          </Button>
          <Button
            aria-label="Maximize window"
            onClick={() => runWindowAction("maximize")}
            size="icon-sm"
            variant="ghost"
          >
            <Maximize2Icon />
          </Button>
          <Button
            aria-label="Close window"
            onClick={() => runWindowAction("close")}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      </div>
    </header>
  );
}
