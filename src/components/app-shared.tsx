import type { ReactNode } from "react";
import {
  DatabaseIcon,
  DownloadIcon,
  FingerprintIcon,
  Globe2Icon,
  LayoutGridIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
} from "lucide-react";

import type { RouteKey } from "@/router";

export type SidebarNavItem = {
  title: string;
  path?: string;
  route?: RouteKey;
  icon?: ReactNode;
  isActive?: boolean;
  subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
  label?: string;
  items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
  {
    label: "Investigate",
    items: [
      {
        title: "Overview",
        path: "#/overview",
        route: "overview",
        icon: <LayoutGridIcon />,
      },
      {
        title: "Search",
        path: "#/search",
        route: "search",
        icon: <SearchIcon />,
      },
      {
        title: "Domains",
        path: "#/domains",
        route: "domains",
        icon: <Globe2Icon />,
      },
      {
        title: "Identities",
        path: "#/identities",
        route: "identities",
        icon: <FingerprintIcon />,
      },
    ],
  },
  {
    label: "Library",
    items: [
      {
        title: "Datasets",
        path: "#/datasets",
        route: "datasets",
        icon: <DatabaseIcon />,
      },
      {
        title: "Saved views",
        path: "#/saved-views",
        route: "saved-views",
        icon: <StarIcon />,
      },
      {
        title: "Exports",
        path: "#/exports",
        route: "exports",
        icon: <DownloadIcon />,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "Settings",
        path: "#/settings",
        route: "settings",
        icon: <SettingsIcon />,
      },
    ],
  },
];

export const footerNavLinks: SidebarNavItem[] = [];

export const navLinks: SidebarNavItem[] = [
  ...navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.subItems?.length ? [item, ...item.subItems] : [item],
    ),
  ),
  ...footerNavLinks,
];
