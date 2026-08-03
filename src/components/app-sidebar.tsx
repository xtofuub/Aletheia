import { useEffect, useState } from "react";
import { BookOpenIcon } from "lucide-react";
import type { RouteKey } from "@/router";
import { navGroups } from "@/components/app-shared";
import { LatestChange } from "@/components/latest-change";
import {
  isLogoVariant,
  LOGO_VARIANTS,
  LogoIcon,
  type LogoVariant,
} from "@/components/logo";
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

const LOGO_STORAGE_KEY = "aletheia.logo-variant";

const faviconByVariant: Record<LogoVariant, string> = {
  ribbon: "/aletheia-ribbon.svg",
  shards: "/aletheia-shards.svg",
  swoop: "/aletheia-swoop.svg",
  orbit: "/aletheia-orbit.svg",
};

export function AppSidebar({ activeRoute }: { activeRoute: RouteKey }) {
  const [logoVariant, setLogoVariant] = useState<LogoVariant>("ribbon");

  useEffect(() => {
    const savedVariant = localStorage.getItem(LOGO_STORAGE_KEY);
    const nextVariant = isLogoVariant(savedVariant) ? savedVariant : "ribbon";
    setLogoVariant(nextVariant);
    document
      .querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?.setAttribute("href", faviconByVariant[nextVariant]);
  }, []);

  const selectLogoVariant = (variant: LogoVariant) => {
    setLogoVariant(variant);
    localStorage.setItem(LOGO_STORAGE_KEY, variant);
    document
      .querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?.setAttribute("href", faviconByVariant[variant]);
  };

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
      <SidebarHeader className="min-h-14 justify-center gap-1.5 border-b px-2 py-2 group-data-[collapsible=icon]:h-14 group-data-[collapsible=icon]:py-1">
        <SidebarMenuButton render={<a href="#/overview" />}>
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white shadow-xs">
            <LogoIcon className="size-4.5" variant={logoVariant} />
          </div>
          <span className="font-medium text-foreground!">Aletheia</span>
        </SidebarMenuButton>
        <div
          aria-label="Aletheia logo concepts"
          className="grid grid-cols-4 gap-1 px-1 group-data-[collapsible=icon]:hidden"
          role="group"
        >
          {LOGO_VARIANTS.map((variant) => (
            <button
              aria-label={`Preview ${variant.label} logo`}
              aria-pressed={logoVariant === variant.id}
              className={cn(
                "flex h-7 items-center justify-center rounded-md bg-zinc-950 text-white opacity-55 transition-[opacity,box-shadow,transform] hover:scale-[1.03] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                logoVariant === variant.id &&
                  "opacity-100 ring-1 ring-foreground/35 ring-offset-1 ring-offset-background",
              )}
              key={variant.id}
              onClick={() => selectLogoVariant(variant.id)}
              title={variant.label}
              type="button"
            >
              <LogoIcon className="size-4" variant={variant.id} />
            </button>
          ))}
        </div>
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
