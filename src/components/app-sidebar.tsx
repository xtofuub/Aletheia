import { BookOpenIcon } from "lucide-react";
import type { RouteKey } from "@/router";
import { navGroups } from "@/components/app-shared";
import { LatestChange } from "@/components/latest-change";
import { LogoIcon } from "@/components/logo";
import { NavGroup } from "@/components/nav-group";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { openReleasePage } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export function AppSidebar({ activeRoute }: { activeRoute: RouteKey }) {
  return (
    <Sidebar
      className={cn(
        "*:data-[slot=sidebar-inner]:bg-background",
        "*:data-[slot=sidebar-inner]:dark:bg-[radial-gradient(60%_18%_at_10%_0%,--theme(--color-foreground/.08),transparent)]",
        "**:data-[slot=sidebar-menu-button]:[&>span]:text-foreground/75",
      )}
      collapsible="icon"
      variant="sidebar"
    >
      <SidebarHeader className="h-12 justify-center border-b px-2">
        <SidebarMenuButton render={<a href="#/overview" />}>
          <LogoIcon />
          <span className="font-medium text-foreground!">Aletheia</span>
        </SidebarMenuButton>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavGroup activeRoute={activeRoute} key={group.label} {...group} />
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-0 p-0">
        <LatestChange />
        <SidebarMenu className="border-t p-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a
                  href="https://github.com/xtofuub/Aletheia"
                  onClick={(event) => {
                    event.preventDefault();
                    void openReleasePage("https://github.com/xtofuub/Aletheia");
                  }}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              tooltip="Documentation"
            >
              <BookOpenIcon />
              <span>Documentation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-4 pt-3 pb-2 transition-opacity group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
          <p className="text-nowrap font-mono text-[9px] text-muted-foreground">
            Local evidence workspace
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
