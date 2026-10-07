/**
 * Turns a school's theme into CSS variables. This is the ONLY place a colour or a font stack from
 * a theme is written into CSS, and it accepts nothing but plain hex colours, a font from a fixed
 * list and small whole-number radii, so a theme (however it got here) can never inject CSS.
 * Components use the variables and never a literal colour or font (checked by test/guards.test.ts).
 */

export class InvalidThemeError extends Error {
  constructor(message: string) {
    super(`Invalid theme: ${message}`);
    this.name = "InvalidThemeError";
  }
}

/** Fonts a school can choose. Every stack ends with a Devanagari-capable font for Nepali text. */
export const FONT_STACKS = {
  system: 'system-ui,-apple-system,"Segoe UI","Noto Sans Devanagari","Nirmala UI",sans-serif',
  inter: '"Inter",system-ui,-apple-system,"Segoe UI","Noto Sans Devanagari","Nirmala UI",sans-serif',
  "noto-sans": '"Noto Sans","Noto Sans Devanagari",system-ui,"Nirmala UI",sans-serif',
} as const;
export type FontKey = keyof typeof FONT_STACKS;

/** Heading fonts (D-088): the body font, or the self-hosted serif. Nepali headings fall back to Noto Sans Devanagari. */
export const HEADING_STACKS = {
  body: "var(--font-body)",
  "source-serif": '"Source Serif 4",Georgia,"Noto Sans Devanagari","Nirmala UI",serif',
} as const;
export type HeadingFontKey = keyof typeof HEADING_STACKS;

const COLOR_TOKENS = {
  background: "--color-background",
  surface: "--color-surface",
  text: "--color-text",
  textMuted: "--color-text-muted",
  border: "--color-border",
  primary: "--color-primary",
  primaryText: "--color-primary-text",
  ok: "--color-ok",
  okSoft: "--color-ok-soft",
  bad: "--color-bad",
  badSoft: "--color-bad-soft",
  accent: "--color-accent",
  accentSoft: "--color-accent-soft",
  warn: "--color-warn",
  warnSoft: "--color-warn-soft",
} as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function colorDeclarations(set: unknown, where: string): string {
  if (!isRecord(set)) throw new InvalidThemeError(`${where} is missing`);
  return Object.entries(COLOR_TOKENS)
    .map(([key, variable]) => {
      const value = set[key];
      if (typeof value !== "string" || !HEX.test(value)) throw new InvalidThemeError(`${where}.${key} must be a hex colour like #1a56db`);
      return `${variable}:${value};`;
    })
    .join("");
}

function radius(value: unknown, where: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new InvalidThemeError(`${where} must be a whole number from 0 to ${max}`);
  }
  return value;
}

/** The CSS text for a theme. Throws `InvalidThemeError` for anything that is not a well-formed theme. */
export function themeToCss(theme: unknown): string {
  if (!isRecord(theme)) throw new InvalidThemeError("not an object");
  const font = theme.font;
  if (typeof font !== "string" || !Object.hasOwn(FONT_STACKS, font)) throw new InvalidThemeError("font is not one of the allowed fonts");
  const heading = theme.headingFont ?? "body";
  if (typeof heading !== "string" || !Object.hasOwn(HEADING_STACKS, heading)) throw new InvalidThemeError("headingFont is not one of the allowed fonts");
  const shape = theme.shape;
  if (!isRecord(shape)) throw new InvalidThemeError("shape is missing");

  const light = colorDeclarations(theme.light, "light");
  const rules =
    `:root{${light}--font-body:${FONT_STACKS[font as FontKey]};--font-heading:${HEADING_STACKS[heading as HeadingFontKey]};` +
    `--radius-card:${radius(shape.radiusCard, "shape.radiusCard", 32)}px;` +
    `--radius-control:${radius(shape.radiusControl, "shape.radiusControl", 24)}px;color-scheme:light;}`;

  if (theme.dark === undefined) return rules;
  return `${rules}@media (prefers-color-scheme:dark){:root{${colorDeclarations(theme.dark, "dark")}color-scheme:dark;}}`;
}

/**
 * The CSS for a person's own colour palette (D-127): only the colour variables, laid over the school's theme. Throws
 * `InvalidThemeError` unless every colour is a plain hex colour, like a school's theme.
 */
export function paletteToCss(colors: unknown): string {
  return `:root{${colorDeclarations(colors, "palette")}}`;
}
