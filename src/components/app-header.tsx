import { getCurrentWindow } from "@tauri-apps/api/window";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2Icon, MinusIcon, SearchIcon, XIcon } from "lucide-react";

import type { RouteKey } from "@/router";
import { navLinks } from "@/components/app-shared";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { DecorIcon } from "@/components/decor-icon";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function AppHeader({ activeRoute }: { activeRoute: RouteKey }) {
  const activeItem = navLinks.find((item) => item.route === activeRoute);
  const fetching = useIsFetching({
    predicate: (query) => {
      const key = String(query.queryKey[0] ?? "");
      return (
        query.state.fetchStatus === "fetching" &&
        (query.state.data === undefined ||
          [
            "search",
            "identity-builder-search",
            "identity-members",
            "domain-details",
          ].includes(key))
      );
    },
  });
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;

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
        <AnimatePresence initial={false}>
          {busy ? (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              aria-live="polite"
              exit={{ opacity: 0, x: 4 }}
              initial={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.14 }}
            >
              <Badge variant="outline">
                <Spinner />
                Working
              </Badge>
            </motion.div>
          ) : null}
        </AnimatePresence>
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
