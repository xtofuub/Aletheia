import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type NavItem = {
  title: string;
  icon: LucideIcon;
  to:
    | "/"
    | "/search"
    | "/datasets"
    | "/identities"
    | "/domains"
    | "/saved-views"
    | "/exports"
    | "/settings";
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export function NavMain({
  sections,
  pathname,
}: {
  sections: NavSection[];
  pathname: string;
}) {
  return sections.map((section) => (
    <SidebarGroup className="p-0 pt-5 first:pt-0" key={section.label}>
      <SidebarGroupLabel className="h-6 px-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground group-data-[collapsible=icon]:sr-only">
        {section.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {section.items.map((item) => {
            const isActive =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`);

            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  render={
                    <Link
                      to={item.to}
                      activeOptions={{ exact: item.to === "/" }}
                    />
                  }
                  className="h-9 rounded-lg px-3 text-[13px] font-medium text-sidebar-foreground/74 data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:stroke-[1.7]"
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}
