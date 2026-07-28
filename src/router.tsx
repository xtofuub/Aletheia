import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";

import { AppShell } from "./components/app-shell";
import { DatasetsPage } from "./pages/datasets-page";
import { DomainsPage } from "./pages/domains-page";
import { ExportsPage } from "./pages/exports-page";
import { IdentitiesPage } from "./pages/identities-page";
import { OverviewPage } from "./pages/overview-page";
import { SavedViewsPage } from "./pages/saved-views-page";
import { SearchPage } from "./pages/search-page";
import { SettingsPage } from "./pages/settings-page";

const rootRoute = createRootRoute({
  component: AppShell,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchPage,
});
const identitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identities",
  component: IdentitiesPage,
});
const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/domains",
  component: DomainsPage,
});
const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/datasets",
  component: DatasetsPage,
});
const savedViewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/saved-views",
  component: SavedViewsPage,
});
const exportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/exports",
  component: ExportsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  searchRoute,
  identitiesRoute,
  domainsRoute,
  datasetsRoute,
  savedViewsRoute,
  exportsRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function RouterView({ router }: { router: AnyRouter }) {
  return <RouterProvider router={router} />;
}
