import { useEffect, useMemo, useState } from "react";

export type RouteKey =
  | "overview"
  | "search"
  | "datasets"
  | "domains"
  | "identities"
  | "saved-views"
  | "exports"
  | "settings";

const validRoutes = new Set<RouteKey>([
  "overview",
  "search",
  "datasets",
  "domains",
  "identities",
  "saved-views",
  "exports",
  "settings",
]);

function readHash() {
  const value = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return value === "dashboard" || !validRoutes.has(value as RouteKey)
    ? "overview"
    : (value as RouteKey);
}

export function useAppRoute() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.location.hash = "#/overview";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const route = readHash();
  const query = useMemo(() => {
    const raw = hash.split("?")[1] ?? "";
    return new URLSearchParams(raw);
  }, [hash]);

  return { route, query };
}

export function routeHref(route: RouteKey, query?: URLSearchParams) {
  const suffix = query?.toString();
  return `#/${route}${suffix ? `?${suffix}` : ""}`;
}
