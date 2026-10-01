import { describe, expect, it } from "vitest";

import { CONTRAST_RULES, FONTS, HEADING_FONTS, ThemeSchema, checkContrast, type Theme } from "../src/core/theme";
import royal from "../../../packs/royal-softech/pack.json";
import sample from "../../../packs/sample-basic-school/pack.json";

const good: Theme = structuredClone(royal.theme) as Theme;
const with_ = (change: (t: Theme) => void): Theme => {
  const copy = structuredClone(good);
  change(copy);
  return copy;
};

describe("theme shape", () => {
  it("accepts both real schools' themes", () => {
    expect(ThemeSchema.safeParse(royal.theme).success).toBe(true);
    expect(ThemeSchema.safeParse(sample.theme).success).toBe(true);
  });

  it.each(["#12345", "1a56db", "blue", "#gggggg", ""])("refuses the colour %j", (bad) => {
    expect(ThemeSchema.safeParse(with_((t) => (t.light.primary = bad))).success).toBe(false);
  });

  it("refuses an unknown key, so nothing sneaks in beside the tokens", () => {
    expect(ThemeSchema.safeParse({ ...good, backgroundImage: "url(https://evil.example/x.png)" }).success).toBe(false);
    expect(ThemeSchema.safeParse(with_((t) => Object.assign(t.light, { customCss: "x" }))).success).toBe(false);
  });

  it("only allows the self-hosted fonts, never an outside address", () => {
    expect([...FONTS]).toEqual(["system", "inter", "noto-sans"]);
    expect(ThemeSchema.safeParse({ ...good, font: "https://fonts.example/evil.woff2" }).success).toBe(false);
    expect(ThemeSchema.safeParse({ ...good, font: "Comic Sans" }).success).toBe(false);
  });

  it("a heading font is optional and only one of the self-hosted ones (D-088)", () => {
    expect([...HEADING_FONTS]).toEqual(["body", "source-serif"]);
    expect(ThemeSchema.safeParse({ ...good, headingFont: "source-serif" }).success).toBe(true);
    const { headingFont: _drop, ...without } = { ...good, headingFont: "body" as const };
    expect(ThemeSchema.safeParse(without).success).toBe(true);
    expect(ThemeSchema.safeParse({ ...good, headingFont: "https://fonts.example/x.woff2" }).success).toBe(false);
  });

  it("the accent (purple) and attention (amber) colours, with their soft tints, are required in every mode (D-088)", () => {
    for (const key of ["accent", "accentSoft", "warn", "warnSoft"] as const) {
      expect(ThemeSchema.safeParse(with_((t) => delete (t.light as Record<string, unknown>)[key])).success, key).toBe(false);
    }
  });

  it.each([
    [{ radiusCard: -1, radiusControl: 4 }],
    [{ radiusCard: 33, radiusControl: 4 }],
    [{ radiusCard: 8, radiusControl: 25 }],
    [{ radiusCard: 8.5, radiusControl: 4 }],
  ])("refuses the corner radii %j", (shape) => {
    expect(ThemeSchema.safeParse({ ...good, shape }).success).toBe(false);
  });
});

describe("readability check", () => {
  it("both real themes pass in every mode", () => {
    expect(checkContrast(good)).toEqual([]);
    expect(checkContrast(sample.theme as Theme)).toEqual([]);
  });

  it("checks eleven pairs, each at AA (4.5 for text, 3 for parts of controls and icons)", () => {
    expect(CONTRAST_RULES).toHaveLength(11);
    for (const rule of CONTRAST_RULES) expect([3, 4.5]).toContain(rule.minimum);
  });

  it("catches faint body text and names the rule, the mode and the ratio", () => {
    const failures = checkContrast(with_((t) => (t.light.text = "#c8c8cc")));
    expect(failures.map((f) => f.rule).sort()).toEqual(["text-on-background", "text-on-surface"]);
    expect(failures[0]).toMatchObject({ mode: "light", minimum: 4.5 });
    expect(failures[0]!.ratio).toBeLessThan(4.5);
  });

  it("catches a button whose label cannot be read", () => {
    const failures = checkContrast(with_((t) => (t.light.primaryText = "#8fb0ff")));
    expect(failures.map((f) => f.rule)).toContain("primary-text");
  });

  it("catches a brand colour too pale to read as text: links and quiet buttons are text, so they need 4.5:1, not 3:1", () => {
    // #3b82f6 is about 3.7:1 on white: fine for a button's edge, too faint for a text link.
    const failures = checkContrast(with_((t) => (t.light.primary = "#3b82f6")));
    const rules = failures.filter((f) => f.rule.startsWith("primary-on-"));
    expect(rules.map((f) => f.rule).sort()).toEqual(["primary-on-background", "primary-on-surface"]);
    for (const f of rules) {
      expect(f.minimum).toBe(4.5);
      expect(f.ratio).toBeLessThan(4.5);
      expect(f.ratio).toBeGreaterThan(3);
    }
  });

  it("catches an accent or attention icon too pale on its own tint (icons need 3:1) (D-088)", () => {
    expect(checkContrast(with_((t) => (t.light.accent = "#d9d0fb"))).map((f) => f.rule)).toContain("accent-icon");
    expect(checkContrast(with_((t) => (t.light.warn = "#fbe3c4"))).map((f) => f.rule)).toContain("warn-icon");
    expect(CONTRAST_RULES.find((r) => r.id === "accent-icon")!.minimum).toBe(3);
  });

  it("catches an error label that is hard to read", () => {
    const failures = checkContrast(with_((t) => (t.light.bad = "#f5a3a3")));
    expect(failures.map((f) => f.rule)).toContain("bad-label");
  });

  it("catches a success label that is hard to read", () => {
    const failures = checkContrast(with_((t) => (t.light.ok = "#7bd493")));
    expect(failures.map((f) => f.rule)).toContain("ok-label");
  });

  // A school may still have a dark set; Royal no longer does (always light, D-088), so the test brings its own.
  const DARK = { background: "#000000", surface: "#1c1c1e", text: "#f5f5f7", textMuted: "#a1a1a6", border: "#38383a", primary: "#4c8dff", primaryText: "#000000", ok: "#4ade80", okSoft: "#12351f", bad: "#f97066", badSoft: "#3a1512", accent: "#b9a3ff", accentSoft: "#2b2340", warn: "#f7a541", warnSoft: "#3d2610" };

  it("a readable dark set passes", () => {
    expect(checkContrast(with_((t) => (t.dark = { ...DARK })))).toEqual([]);
  });

  it("checks the dark set with the same rules, and says which mode failed", () => {
    const failures = checkContrast(with_((t) => (t.dark = { ...DARK, textMuted: "#333333" })));
    expect(failures.length).toBeGreaterThan(0);
    for (const f of failures) expect(f.mode).toBe("dark");
  });

  it("a theme with no dark set is checked in light only", () => {
    expect(checkContrast(sample.theme as Theme)).toEqual([]);
  });

  it("the same colour for text and background fails everything that involves them", () => {
    const failures = checkContrast(with_((t) => (t.light.text = t.light.background)));
    expect(failures.map((f) => f.rule)).toContain("text-on-background");
  });

  it("a borderline pair passes at exactly the limit and fails just under it", () => {
    // #767676 on white is 4.54 (passes); #777777 is 4.48 (fails).
    const passes = checkContrast(with_((t) => { t.light.text = "#767676"; t.light.background = "#ffffff"; t.light.surface = "#ffffff"; }));
    const fails = checkContrast(with_((t) => { t.light.text = "#777777"; t.light.background = "#ffffff"; t.light.surface = "#ffffff"; }));
    expect(passes.filter((f) => f.rule.startsWith("text-on"))).toEqual([]);
    expect(fails.filter((f) => f.rule.startsWith("text-on")).length).toBe(2);
  });
});
