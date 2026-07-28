import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookMarked,
  CircleGauge,
  Database,
  Download,
  Globe2,
  IdCard,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";

import {
  NavMain,
  type NavSection,
} from "@/components/shadcn-dashboard/blocks/sidebar/sidebar-01/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navSections: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", icon: CircleGauge, to: "/" },
      { title: "Search", icon: Search, to: "/search" },
      { title: "Datasets", icon: Database, to: "/datasets" },
    ],
  },
  {
    label: "Investigate",
    items: [
      { title: "Identities", icon: IdCard, to: "/identities" },
      { title: "Domains", icon: Globe2, to: "/domains" },
      { title: "Saved views", icon: BookMarked, to: "/saved-views" },
    ],
  },
  {
    label: "Output",
    items: [
      { title: "Exports", icon: Download, to: "/exports" },
      { title: "Settings", icon: Settings, to: "/settings" },
    ],
  },
];

export function AppSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar collapsible="icon" variant="inset" className="aletheia-sidebar">
      <SidebarHeader className="h-[58px] justify-center border-b border-sidebar-border px-4 py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Aletheia"
              render={<Link to="/" />}
              className="h-10 rounded-md px-0 hover:bg-transparent data-active:bg-transparent group-data-[collapsible=icon]:justify-center"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-foreground text-[13px] font-bold tracking-[-0.04em] text-background">
                A
              </span>
              <span className="min-w-0 flex-1 text-left text-[15px] font-semibold tracking-[-0.025em]">
                Aletheia
              </span>
              <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                v0.1
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <nav aria-label="Primary">
          <NavMain sections={navSections} pathname={pathname} />
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="local-protection group-data-[collapsible=icon]:hidden">
          <div className="local-protection__heading">
            <ShieldCheck aria-hidden="true" />
            <span>Local protection</span>
          </div>
          <p>Evidence stays on this device.</p>
          <div className="local-protection__states">
            <span>Offline</span>
            <span>Read-only</span>
            <span>Masked</span>
          </div>
        </div>
        <div className="hidden size-8 place-items-center text-muted-foreground group-data-[collapsible=icon]:grid">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
