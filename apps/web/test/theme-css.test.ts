import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@/theme/default-theme";
import { FONT_STACKS, InvalidThemeError, themeToCss } from "@/theme/css";
import { checkContrast } from "../../api/src/core/theme"; // the server's own readability rules, applied to our built-in theme
import royal from "../../../packs/royal-softech/pack.json";
import sample from "../../../packs/sample-basic-school/pack.json";

const clone = <T>(x: T): T => structuredClone(x);

describe("themeToCss", () => {
  it("turns a theme into variables on :root, with dark mode following the device when the theme has one", () => {
    const css = themeToCss(royal.theme);

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

  it.each([
    ["a colour that is a CSS injection", (t: typeof royal.theme) => (t.light.primary = "red;} body{display:none")],
    ["a colour name", (t: typeof royal.theme) => (t.light.text = "black")],
    ["a url()", (t: typeof royal.theme) => (t.light.background = "url(https://evil.example/x)")],
    ["a colour in the dark set", (t: typeof royal.theme) => (t.dark!.surface = "#12")],
  ])("refuses %s, so nothing but plain colours can ever reach the page", (_label, mutate) => {
    const bad = clone(royal.theme);
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
