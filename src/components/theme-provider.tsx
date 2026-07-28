import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { updateTheme, type Theme } from "../lib/desktop";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  hydrateTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: Theme) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<Theme>("dark");

  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = resolveTheme(next);
    document.documentElement.style.colorScheme = resolveTheme(next);
  }, []);

  const hydrateTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      applyTheme(next);
    },
    [applyTheme],
  );

  const setTheme = useCallback(
    async (next: Theme) => {
      applyTheme(next);
      setThemeState(next);
      await updateTheme(next);
    },
    [applyTheme],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme === "system") applyTheme(theme);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [applyTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, hydrateTheme }),
    [hydrateTheme, setTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
