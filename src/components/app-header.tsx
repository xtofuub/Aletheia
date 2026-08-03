import { SearchIcon } from "lucide-react";

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

  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 md:px-6",
        "bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/50",
      )}
    >
      <DecorIcon className="hidden md:block" position="bottom-left" />
      <div className="flex items-center gap-3">
        <CustomSidebarTrigger />
        <Separator orientation="vertical" />
        <AppBreadcrumbs page={activeItem ?? null} />
      </div>
      <div className="flex items-center gap-2">
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
      </div>
    </header>
  );
}
