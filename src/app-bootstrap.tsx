import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getSettings, isTauriRuntime } from "@/lib/desktop";
import { useAppRoute } from "@/router";
import { OnboardingPage } from "@/pages/onboarding-page";
import { applyTheme } from "@/theme-provider";

const OverviewPage = lazy(() =>
  import("@/pages/overview-page").then((module) => ({
    default: module.OverviewPage,
  })),
);
const SearchPage = lazy(() =>
  import("@/pages/search-page").then((module) => ({
    default: module.SearchPage,
  })),
);
const DatasetsPage = lazy(() =>
  import("@/pages/datasets-page").then((module) => ({
    default: module.DatasetsPage,
  })),
);
const DomainsPage = lazy(() =>
  import("@/pages/domains-page").then((module) => ({
    default: module.DomainsPage,
  })),
);
const IdentitiesPage = lazy(() =>
  import("@/pages/identities-page").then((module) => ({
    default: module.IdentitiesPage,
  })),
);
const SavedViewsPage = lazy(() =>
  import("@/pages/saved-views-page").then((module) => ({
    default: module.SavedViewsPage,
  })),
);
const ExportsPage = lazy(() =>
  import("@/pages/exports-page").then((module) => ({
    default: module.ExportsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings-page").then((module) => ({
    default: module.SettingsPage,
  })),
);

export function AppBootstrap() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const { route, query } = useAppRoute();

  if (settings.isError) {
    return (
      <Empty className="min-h-screen">
        <EmptyHeader>
          <EmptyTitle>Workspace unavailable</EmptyTitle>
          <EmptyDescription>{String(settings.error)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!settings.data) return null;
  applyTheme(settings.data.theme);

  if (isTauriRuntime() && !settings.data.authorizationConfirmed) {
    return (
      <OnboardingPage
        initialStorageRoot={settings.data.storageRoot}
        onComplete={() =>
          void queryClient.invalidateQueries({ queryKey: ["settings"] })
        }
      />
    );
  }

  let page;
  switch (route) {
    case "search":
      page = (
        <SearchPage
          initialDatasetId={query.get("dataset") ?? "all"}
          initialQuery={query.get("q") ?? ""}
          initialSurface={
            query.get("surface") === "direct" ? "direct" : "index"
          }
        />
      );
      break;
    case "datasets":
      page = <DatasetsPage />;
      break;
    case "domains":
      page = <DomainsPage />;
      break;
    case "identities":
      page = <IdentitiesPage />;
      break;
    case "saved-views":
      page = <SavedViewsPage />;
      break;
    case "exports":
      page = <ExportsPage />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    default:
      page = <OverviewPage />;
  }

  return (
    <AppShell activeRoute={route}>
      <Suspense fallback={<DashboardSkeleton />}>{page}</Suspense>
    </AppShell>
  );
}
