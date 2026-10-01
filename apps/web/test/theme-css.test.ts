import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@/theme/default-theme";
import { FONT_STACKS, HEADING_STACKS, InvalidThemeError, themeToCss } from "@/theme/css";
import { checkContrast } from "../../api/src/core/theme"; // the server's own readability rules, applied to our built-in theme
import royal from "../../../packs/royal-softech/pack.json";
import sample from "../../../packs/sample-basic-school/pack.json";

const clone = <T>(x: T): T => structuredClone(x);
/** A school may still have a dark set; Royal no longer does (always light, D-088), so these tests bring their own. */
const DARK = { background: "#000000", surface: "#1c1c1e", text: "#f5f5f7", textMuted: "#a1a1a6", border: "#38383a", primary: "#4c8dff", primaryText: "#000000", ok: "#4ade80", okSoft: "#12351f", bad: "#f97066", badSoft: "#3a1512", accent: "#b9a3ff", accentSoft: "#2b2340", warn: "#f7a541", warnSoft: "#3d2610" };
const withDark = () => ({ ...clone(royal.theme), dark: { ...DARK } });

describe("themeToCss", () => {
  it("turns a theme into variables on :root, with dark mode following the device when the theme has one", () => {
    const css = themeToCss(withDark());

    expect(css).toContain(":root{");
    expect(css).toContain("--color-primary:#1a56db;");
    expect(css).toContain("--color-primary-text:#ffffff;");
    expect(css).toContain("--color-text-muted:#5b5b62;");
    expect(css).toContain("--radius-card:18px;");
    expect(css).toContain("--radius-control:12px;");
    expect(css).toContain("color-scheme:light;");
    expect(css).toContain("@media (prefers-color-scheme:dark){:root{");
    expect(css).toContain("--color-primary:#4c8dff;");
    expect(css).toContain("color-scheme:dark;");
  });

  it("Royal Softech is always light (D-088): no dark block", () => {
    expect(themeToCss(royal.theme)).not.toContain("prefers-color-scheme");
  });

  it("a light-only theme has no dark block", () => {
    const css = themeToCss(sample.theme);
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toContain("--color-primary:#c2410c;");
    expect(css).toContain("--radius-card:4px;");
  });

  it("the two schools produce different CSS, and only in variable values", () => {
    const a = themeToCss(royal.theme);
    const b = themeToCss(sample.theme);
    expect(a).not.toBe(b);
    for (const css of [a, b]) {
      // Everything is a custom property, a media query or color-scheme: no selectors but :root.
      const selectors = css.replace(/@media \(prefers-color-scheme:dark\)\{/g, "").match(/[^{}]+(?=\{)/g)!;
      expect(selectors.every((selector) => selector === ":root")).toBe(true);
    }
  });

  it("chooses the font from the fixed list", () => {
    expect(themeToCss(royal.theme)).toContain(`--font-body:${FONT_STACKS.inter};`);
    expect(themeToCss(sample.theme)).toContain(`--font-body:${FONT_STACKS["noto-sans"]};`);
    expect(FONT_STACKS["noto-sans"]).toContain("Noto Sans Devanagari"); // Nepali text must have a font
    for (const stack of Object.values(FONT_STACKS)) expect(stack).toMatch(/sans-serif$/);
  });

  it("writes the accent and attention colours, and the heading font: the serif when asked, else the body font (D-088)", () => {
    const css = themeToCss(royal.theme);
    for (const v of ["--color-accent:", "--color-accent-soft:", "--color-warn:", "--color-warn-soft:"]) expect(css).toContain(v);
    expect(css).toContain(`--font-heading:${HEADING_STACKS["source-serif"]};`);
    expect(themeToCss(sample.theme)).toContain("--font-heading:var(--font-body);");
    expect(HEADING_STACKS["source-serif"]).toContain("Noto Sans Devanagari"); // Nepali headings still have a font
    const bad = clone(royal.theme) as Record<string, unknown>;
    bad.headingFont = "url(https://evil.example/x.woff2)";
    expect(() => themeToCss(bad)).toThrow(InvalidThemeError);
  });

  it.each([
    ["a colour that is a CSS injection", (t: ReturnType<typeof withDark>) => (t.light.primary = "red;} body{display:none")],
    ["a colour name", (t: ReturnType<typeof withDark>) => (t.light.text = "black")],
    ["a url()", (t: ReturnType<typeof withDark>) => (t.light.background = "url(https://evil.example/x)")],
    ["a colour in the dark set", (t: ReturnType<typeof withDark>) => (t.dark.surface = "#12")],
  ])("refuses %s, so nothing but plain colours can ever reach the page", (_label, mutate) => {
    const bad = withDark();
    mutate(bad);
    expect(() => themeToCss(bad)).toThrow(InvalidThemeError);
  });

  it("refuses a radius or font that is not allowed", () => {
    const bad = clone(royal.theme) as Record<string, unknown>;
    bad.font = "Comic Sans";
    expect(() => themeToCss(bad as never)).toThrow(InvalidThemeError);

    const worse = clone(royal.theme);
    worse.shape.radiusCard = -1;
    expect(() => themeToCss(worse)).toThrow(InvalidThemeError);
    worse.shape.radiusCard = 1e9;
    expect(() => themeToCss(worse)).toThrow(InvalidThemeError);
  });
});

describe("the built-in default theme (shown until a school's own theme arrives)", () => {
  it("is readable, by the same rules the server enforces", () => {
    expect(checkContrast(DEFAULT_THEME)).toEqual([]);
  });

  it("names no school", () => {
    expect(JSON.stringify(DEFAULT_THEME).toLowerCase()).not.toMatch(/royal|softech|lahan/);
  });
});
