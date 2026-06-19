/* eslint-disable react-refresh/only-export-components -- exports the useTheme hook alongside the provider component */
import { createContext, useContext, useEffect, useState } from "react";
import type { OriginTheme } from "./types";
import { applyTheme } from "./applyTheme";

const themeModules = import.meta.glob<{ default: OriginTheme }>(
  "./**/theme.json",
  { eager: true }
);

export const builtinThemes: OriginTheme[] = Object.values(themeModules).map(
  (m) => m.default
);

function resolveDefaultTheme(): OriginTheme {
  // 1. Respect saved preference
  const saved = localStorage.getItem("origin-theme");
  if (saved) {
    const match = builtinThemes.find((t) => t.name === saved);
    if (match) return match;
  }
  // 2. Fall back to OS preference
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const fallbackName = prefersDark ? "Origin Dark" : "Origin Light";
  return builtinThemes.find((t) => t.name === fallbackName) ?? builtinThemes[0];
}

interface ThemeContextValue {
  theme: OriginTheme;
  themes: OriginTheme[];
  setTheme: (theme: OriginTheme) => void;
  loadThemeFromJson: (json: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<OriginTheme>(resolveDefaultTheme);

  function setTheme(t: OriginTheme) {
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem("origin-theme", t.name);
  }

  function loadThemeFromJson(json: string) {
    try {
      const parsed = JSON.parse(json) as OriginTheme;
      if (!parsed.name || !parsed.colors) throw new Error("Invalid theme file");
      setTheme(parsed);
    } catch (e) {
      console.error("Failed to load theme:", e);
    }
  }

  useEffect(() => {
    applyTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply persisted theme once on mount; subsequent changes flow through setTheme
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themes: builtinThemes, setTheme, loadThemeFromJson }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
