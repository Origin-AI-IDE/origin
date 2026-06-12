export type ThemeType = "dark" | "light";

export interface OriginTheme {
  name: string;
  type: ThemeType;
  colors: Record<string, string>;
}
