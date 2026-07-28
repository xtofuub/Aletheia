import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Onboarding } from "./components/onboarding";
import { Skeleton } from "./components/ui/skeleton";
import { getSettings } from "./lib/desktop";
import { router, RouterView } from "./router";
import { useTheme } from "./components/theme-provider";

export const settingsQueryKey = ["settings"] as const;

function StartupState() {
  return (
    <main className="startup-state" aria-label="Opening Aletheia">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Aletheia</p>
            <p className="text-xs text-text-tertiary">
              Opening local workspace
            </p>
          </div>
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="mt-3 h-2 w-3/5" />
      </div>
    </main>
  );
}

function StartupError({ retry }: { retry: () => void }) {
  return (
    <main className="startup-state">
      <div className="max-w-md border-l-2 border-danger pl-5">
        <h1 className="text-lg font-semibold text-text-primary">
          Local workspace could not open
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Aletheia could not initialize its metadata database. No source file
          was opened or changed.
        </p>
        <button
          className="mt-5 text-sm font-semibold text-signal hover:text-signal-strong"
          onClick={retry}
        >
          Try again
        </button>
      </div>
    </main>
  );
}

export function AppBootstrap() {
  const queryClient = useQueryClient();
  const { hydrateTheme } = useTheme();
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: getSettings,
  });

  useEffect(() => {
    if (settings.data) hydrateTheme(settings.data.theme);
  }, [hydrateTheme, settings.data]);

  if (settings.isPending) return <StartupState />;
  if (settings.isError) {
    return <StartupError retry={() => void settings.refetch()} />;
  }
  if (!settings.data.authorizationConfirmed) {
    return (
      <Onboarding
        initialStorageRoot={settings.data.storageRoot}
        onComplete={(next) => {
          queryClient.setQueryData(settingsQueryKey, next);
        }}
      />
    );
  }

  return <RouterView router={router} />;
}
