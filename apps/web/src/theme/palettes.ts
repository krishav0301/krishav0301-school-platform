import type { MessageKey } from "@/i18n/messages";

/**
 * Colour themes a person may choose for their own portal (D-127, the PM). Only colours: the school's font, shapes and
 * name stay. The status colours (done, attention, problem) are the same in every palette, so a status always looks the
 * same. Each palette passes the server's readability rules (`test/palettes.test.ts`). This file and `default-theme.ts`
 * are the only web files that write colours out (`test/guards.test.ts`).
 */
export interface PaletteColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryText: string;
  ok: string;
  okSoft: string;
  bad: string;
  badSoft: string;
  accent: string;
  accentSoft: string;
  warn: string;
  warnSoft: string;
}

const STATUS = { ok: "#146c2e", okSoft: "#dcf5e3", bad: "#b42318", badSoft: "#fde4e1", warn: "#b54708", warnSoft: "#fef0e1" } as const;

export interface Palette {
  key: string;
  name: MessageKey;
  colors: PaletteColors;
}

/** The choices besides the school's own colours (`SCHOOL_PALETTE`), in the order they are offered. */
export const PALETTES: readonly Palette[] = [
  {
    // The warm palette the PM liked on 2026-10-07 (first seen on the sample school).
    key: "terracotta",
    name: "appearance.palette.terracotta",
    colors: { background: "#fff7ed", surface: "#ffffff", text: "#431407", textMuted: "#7c2d12", border: "#fdba74", primary: "#c2410c", primaryText: "#ffffff", accent: "#7a3eb1", accentSoft: "#f3eafb", ok: "#166534", okSoft: "#dcfce7", bad: "#991b1b", badSoft: "#fee2e2", warn: "#a15c07", warnSoft: "#fdf3e2" },
  },
  {
    key: "sage",
    name: "appearance.palette.sage",
    colors: { background: "#f3f7f4", surface: "#ffffff", text: "#16211b", textMuted: "#4c5b52", border: "#cddbd2", primary: "#2f6b4f", primaryText: "#ffffff", accent: "#35698c", accentSoft: "#e5eff6", ...STATUS },
  },
  {
    key: "lavender",
    name: "appearance.palette.lavender",
    colors: { background: "#f7f5fc", surface: "#ffffff", text: "#1e1a2d", textMuted: "#5a536d", border: "#ddd6ee", primary: "#5b3fb5", primaryText: "#ffffff", accent: "#a63e72", accentSoft: "#fbe9f2", ...STATUS },
  },
  {
    key: "ocean",
    name: "appearance.palette.ocean",
    colors: { background: "#f1f6f9", surface: "#ffffff", text: "#0f1e28", textMuted: "#475b68", border: "#ccdce5", primary: "#0e6584", primaryText: "#ffffff", accent: "#3b55c9", accentSoft: "#e8ecfb", ...STATUS },
  },
  {
    key: "graphite",
    name: "appearance.palette.graphite",
    colors: { background: "#f5f5f7", surface: "#ffffff", text: "#1d1d1f", textMuted: "#5b5b62", border: "#d2d2d7", primary: "#36363f", primaryText: "#ffffff", accent: "#5555c9", accentSoft: "#ececfb", ...STATUS },
  },
];

/** The key for "the school's own colours": no palette over the school's theme. */
export const SCHOOL_PALETTE = "school";
