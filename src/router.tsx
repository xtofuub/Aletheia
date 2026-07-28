import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";

import { AppShell } from "./components/app-shell";

const rootRoute = createRootRoute({
  component: AppShell,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("./pages/overview-page"),
    "OverviewPage",
  ),
});
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: lazyRouteComponent(
    () => import("./pages/search-page"),
    "SearchPage",
  ),
});
const identitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/identities",
  component: lazyRouteComponent(
    () => import("./pages/identities-page"),
    "IdentitiesPage",
  ),
});
const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/domains",
  component: lazyRouteComponent(
    () => import("./pages/domains-page"),
    "DomainsPage",
  ),
});
const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/datasets",
  component: lazyRouteComponent(
    () => import("./pages/datasets-page"),
    "DatasetsPage",
  ),
});
const savedViewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/saved-views",
  component: lazyRouteComponent(
    () => import("./pages/saved-views-page"),
    "SavedViewsPage",
  ),
});
const exportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/exports",
  component: lazyRouteComponent(
    () => import("./pages/exports-page"),
    "ExportsPage",
  ),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("./pages/settings-page"),
    "SettingsPage",
  ),
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
