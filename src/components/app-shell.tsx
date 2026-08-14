import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

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
  const reduceMotion = useReducedMotion();

  return (
    <SidebarProvider className={cn("[--app-wrapper-max-width:92rem]")}>
      <AppSidebar activeRoute={activeRoute} />
      <SidebarInset>
        <AppHeader activeRoute={activeRoute} />
        <ActiveDomainScan />
        <AnimatePresence initial={false} mode="wait">
          <motion.main
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex w-full max-w-(--app-wrapper-max-width) flex-1 flex-col p-4 md:p-6"
            exit={reduceMotion ? {} : { opacity: 0, y: -3 }}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            key={activeRoute}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </SidebarInset>
    </SidebarProvider>
  );
}
