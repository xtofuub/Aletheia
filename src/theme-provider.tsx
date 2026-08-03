import { useEffect, type ReactNode } from "react";

import type { Theme } from "@/lib/desktop";

export function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  window.localStorage.setItem("aletheia.theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const stored = window.localStorage.getItem(
      "aletheia.theme",
    ) as Theme | null;
    applyTheme(stored ?? "system");
  }, []);

  return children;
}
