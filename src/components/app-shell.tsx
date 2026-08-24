import type { ReactNode } from "react";

import type { RouteKey } from "@/router";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { ActiveDomainScan } from "@/components/active-domain-scan";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AppShell({
  activeRoute,
  children,
}: {
  activeRoute: RouteKey;
  children: ReactNode;
}) {
  return (
    <SidebarProvider className={cn("[--app-wrapper-max-width:92rem]")}>
      <AppSidebar activeRoute={activeRoute} />
      <SidebarInset>
        <AppHeader activeRoute={activeRoute} />
        <ActiveDomainScan />
        <main
          className="page-enter mx-auto flex w-full max-w-(--app-wrapper-max-width) flex-1 flex-col p-4 md:p-6"
          key={activeRoute}
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
