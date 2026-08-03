import type { ReactNode } from "react";

import type { RouteKey } from "@/router";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
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
        <main className="mx-auto flex w-full max-w-(--app-wrapper-max-width) flex-1 flex-col p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
