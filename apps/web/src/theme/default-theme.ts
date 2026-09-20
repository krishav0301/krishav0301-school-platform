import type { components } from "@/api/schema";

export type Theme = NonNullable<components["schemas"]["PublicConfig"]["theme"]>;

/**
 * The platform's own neutral theme. It is built into every page, so the first paint is readable
 * before (or without) a school's theme arriving. It names no school. It has to pass the same
 * readability rules the server enforces (checked by test/theme-css.test.ts).
 */
export const DEFAULT_THEME: Theme = {
  name: "Platform default",
  font: "system",
  shape: { radiusCard: 16, radiusControl: 10 },
  light: {
    background: "#f5f5f7",
    surface: "#ffffff",
    text: "#1d1d1f",
    textMuted: "#5b5b62",
    border: "#d2d2d7",
    primary: "#2563eb",
    primaryText: "#ffffff",
    ok: "#146c2e",
    okSoft: "#dcf5e3",
    bad: "#b42318",
    badSoft: "#fde4e1",
  },
  dark: {
    background: "#0b0b0d",
    surface: "#1c1c1e",
    text: "#f5f5f7",
    textMuted: "#a1a1a6",
    border: "#38383a",
    primary: "#60a5fa",
    primaryText: "#0b0b0d",
    ok: "#4ade80",
    okSoft: "#12351f",
    bad: "#f97066",
    badSoft: "#3a1512",
  },
};
