import type { PinnedMessage } from "./aiTypes";

export const PINBOARD_KEY = (fp: string) => `origin-pinboard:${fp || "global"}`;
export const NOTES_KEY    = (fp: string) => `origin-pinboard-notes:${fp || "global"}`;

export function pbRead(fp: string): PinnedMessage[] {
  try { return JSON.parse(localStorage.getItem(PINBOARD_KEY(fp)) ?? "[]"); }
  catch { return []; }
}

export function pbWrite(fp: string, pins: PinnedMessage[]): void {
  localStorage.setItem(PINBOARD_KEY(fp), JSON.stringify(pins));
}

export function pinPreview(pin: PinnedMessage): string {
  if (pin.label) return pin.label;
  return pin.content
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`[^`]+`/g, s => s.slice(1, -1))
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 72);
}
