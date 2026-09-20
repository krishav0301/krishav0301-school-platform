/**
 * The theme contract: the only things a school can change about how the product looks, and the
 * readability rules every theme must pass (docs/source/sample-creation-information.md, 5.9).
 * Components use these tokens only; there are no hardcoded colours or fonts anywhere else.
 */
import { z } from "@hono/zod-openapi";

import { contrastRatio } from "./contrast";

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "a colour like #1a56db");

export const ColorSetSchema = z.strictObject({
  background: hex,
  surface: hex,
  text: hex,
  textMuted: hex,
  border: hex,
  primary: hex,
  /** Text and icons drawn on the primary colour, such as a button label. */
  primaryText: hex,
  ok: hex,
  okSoft: hex,
  bad: hex,
  badSoft: hex,
});
export type ColorSet = z.infer<typeof ColorSetSchema>;

/** Self-hosted fonts only (D: host fonts ourselves). A school cannot point at an outside font. */
export const FONTS = ["system", "inter", "noto-sans"] as const;

export const ThemeSchema = z
  .strictObject({
    name: z.string().min(1).max(60),
    font: z.enum(FONTS),
    shape: z.strictObject({
      radiusCard: z.number().int().min(0).max(32),
      radiusControl: z.number().int().min(0).max(24),
    }),
    light: ColorSetSchema,
    /** Optional dark mode. If present it must pass the same rules. */
    dark: ColorSetSchema.optional(),
  })
  .openapi("Theme");
export type Theme = z.infer<typeof ThemeSchema>;

export interface ContrastRule {
  id: string;
  label: string;
  foreground: keyof ColorSet;
  background: keyof ColorSet;
  /** WCAG AA: 4.5 for text, 3 for parts of controls. */
  minimum: number;
}

export const CONTRAST_RULES: readonly ContrastRule[] = [
  { id: "text-on-background", label: "Body text on the page", foreground: "text", background: "background", minimum: 4.5 },
  { id: "text-on-surface", label: "Body text on cards", foreground: "text", background: "surface", minimum: 4.5 },
  { id: "muted-on-background", label: "Secondary text on the page", foreground: "textMuted", background: "background", minimum: 4.5 },
  { id: "muted-on-surface", label: "Secondary text on cards", foreground: "textMuted", background: "surface", minimum: 4.5 },
  { id: "primary-text", label: "Button labels", foreground: "primaryText", background: "primary", minimum: 4.5 },
  { id: "primary-on-background", label: "Buttons and links against the page", foreground: "primary", background: "background", minimum: 3 },
  { id: "primary-on-surface", label: "Buttons and links against cards", foreground: "primary", background: "surface", minimum: 3 },
  { id: "ok-label", label: "Success labels", foreground: "ok", background: "okSoft", minimum: 4.5 },
  { id: "bad-label", label: "Error labels", foreground: "bad", background: "badSoft", minimum: 4.5 },
];

export interface ContrastFailure {
  mode: "light" | "dark";
  rule: string;
  label: string;
  ratio: number;
  minimum: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every rule the theme breaks, in light and dark. Empty means the theme is readable. */
export function checkContrast(theme: Theme): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const mode of ["light", "dark"] as const) {
    const colors = theme[mode];
    if (!colors) continue;
    for (const rule of CONTRAST_RULES) {
      const ratio = contrastRatio(colors[rule.foreground], colors[rule.background]);
      if (ratio < rule.minimum) failures.push({ mode, rule: rule.id, label: rule.label, ratio: round2(ratio), minimum: rule.minimum });
    }
  }
  return failures;
}
