import type { OriginTheme } from "./types";

// "bg.editor" → "--origin-bg-editor"
function tokenToCssVar(token: string): string {
  return "--origin-" + token.replace(/\./g, "-");
}

export function applyTheme(theme: OriginTheme): void {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(tokenToCssVar(token), value);
  }
  root.setAttribute("data-theme", theme.type);
}
