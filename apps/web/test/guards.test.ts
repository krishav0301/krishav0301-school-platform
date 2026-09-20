import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The rules from CLAUDE.md section 7, checked mechanically over the web source:
 * no hardcoded colours or fonts (everything comes from theme tokens), animation limited to
 * transform and opacity, and all visible text going through the message catalog. These fail the
 * build, so a later change cannot quietly break them.
 */
const src = join(import.meta.dirname, "..", "src");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
const rel = (file: string) => relative(src, file).split(sep).join("/");
const sources = [...walk(src)].filter((f) => /\.(css|tsx?)$/.test(f) && !f.endsWith(".d.ts"));
const stylesheets = sources.filter((f) => f.endsWith(".css"));
const read = (file: string) => readFileSync(file, "utf8");

// The built-in default theme and the font stacks are where colours and fonts may be written out.
const ALLOWED_LITERALS = new Set(["theme/default-theme.ts", "theme/css.ts"]);

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("no hardcoded colours or fonts", () => {
  it("finds the source files (so the checks below are not passing on nothing)", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(stylesheets.length).toBeGreaterThan(3);
  });

  it("no hex, rgb(), hsl() or colour-name values outside the theme files", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (ALLOWED_LITERALS.has(rel(file))) continue;
      const text = stripComments(read(file));
      if (/#[0-9a-fA-F]{3,8}\b/.test(text.replace(/&#\d+;/g, ""))) offenders.push(`${rel(file)}: hex colour`);
      if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/i.test(text)) offenders.push(`${rel(file)}: colour function`);
    }
    const colourProperty = /^(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke|box-shadow|text-decoration-color|caret-color|accent-color)\s*:/i;
    const colourName = /\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal)\b/i;
    for (const file of stylesheets) {
      const declarations = stripComments(read(file)).match(/[a-z-]+\s*:\s*[^;{}]+/gi) ?? [];
      for (const d of declarations) {
        if (colourProperty.test(d) && colourName.test(d.replace(/var\([^)]*\)/g, ""))) offenders.push(`${rel(file)}: colour name in "${d.trim()}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no font-family written out: fonts come from --font-body", () => {
    const offenders = stylesheets.filter((f) => /font-family\s*:(?!\s*var\()/.test(stripComments(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the patterns used above really do match what they are meant to catch", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test("color: #ff0000;")).toBe(true);
    expect(/\b(?:rgba?|hsla?)\(/i.test("background: rgba(0,0,0,.5)")).toBe(true);
    expect(/font-family\s*:(?!\s*var\()/.test("font-family: Arial")).toBe(true);
    expect(/font-family\s*:(?!\s*var\()/.test("font-family: var(--font-body)")).toBe(false);
  });
});

describe("motion", () => {
  it("transitions animate only transform and opacity", () => {
    const offenders: string[] = [];
    for (const file of stylesheets) {
      for (const [, value] of stripComments(read(file)).matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)) {
        for (const part of value!.split(",")) {
          const property = part.trim().split(/\s+/)[0]!;
          if (!["transform", "opacity", "none"].includes(property)) offenders.push(`${rel(file)}: transition on "${property}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keyframes touch only transform and opacity", () => {
    const offenders: string[] = [];
    for (const file of stylesheets) {
      for (const [, body] of stripComments(read(file)).matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
        for (const [, property] of body!.matchAll(/([a-z-]+)\s*:/g)) {
          if (!["transform", "opacity"].includes(property!)) offenders.push(`${rel(file)}: keyframe sets "${property}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reduced motion is respected globally", () => {
    expect(read(join(src, "app", "globals.css"))).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe("visible text goes through the message catalog", () => {
  // The internal component gallery is English-only by design.
  const checked = sources.filter((f) => f.endsWith(".tsx") && rel(f) !== "app/design/page.tsx");

  it("finds components to check", () => {
    expect(checked.length).toBeGreaterThan(5);
  });

  it("no sentence is written directly between JSX tags", () => {
    const offenders: string[] = [];
    for (const file of checked) {
      for (const [, words] of stripComments(read(file)).matchAll(/>\s*([A-Za-z][^<>{}\n();=[\]]*\s+[A-Za-z][^<>{}\n();=[\]]*)\s*</g)) {
        offenders.push(`${rel(file)}: "${words!.trim()}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no label, placeholder, title or alt text is written out as a string", () => {
    const offenders: string[] = [];
    for (const file of checked) {
      for (const [, attribute, value] of stripComments(read(file)).matchAll(/\b(aria-label|placeholder|title|alt)="([^"]+)"/g)) {
        offenders.push(`${rel(file)}: ${attribute}="${value}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the message catalog has no dead words", () => {
  it("every message is used by some component or page", async () => {
    const { en } = await import("@/i18n/messages");
    const code = sources.filter((f) => /\.tsx?$/.test(f) && rel(f) !== "i18n/messages.ts").map(read).join("\n");
    const unused = Object.keys(en).filter((key) => !code.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });
});

describe("touch targets", () => {
  const css = (name: string) => read(join(src, name));

  it("the brand link, menu entries and buttons are at least a full control tall (44px)", () => {
    expect(css("shell/shell.module.css")).toMatch(/\.brand\s*\{[^}]*min-height:\s*var\(--control-height\)/);
    expect(css("shell/shell.module.css")).toMatch(/\.navLink\s*\{[^}]*min-height:\s*3\.25rem/); // tab bar: 52px
    expect(css("ui/Button.module.css")).toMatch(/\.button\s*\{[^}]*min-height:\s*var\(--control-height\)/);
    expect(css("ui/Field.module.css")).toMatch(/\.input\s*\{[^}]*min-height:\s*var\(--control-height\)/);
    expect(css("ui/Field.module.css")).toMatch(/\.toggle\s*\{[^}]*min-width:\s*var\(--control-height\)/);
  });

  it("the control height itself is 44px or more", () => {
    const match = css("app/tokens.css").match(/--control-height:\s*([\d.]+)rem/);
    expect(Number(match![1]) * 16).toBeGreaterThanOrEqual(44);
  });
});

describe("large text and narrow screens", () => {
  const css = (name: string) => read(join(src, name));

  it("the page is one column exactly as wide as the screen, so enlarged text wraps instead of widening the page", () => {
    expect(css("shell/shell.module.css")).toMatch(/\.frame\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("button labels stay on one line", () => {
    expect(css("ui/Button.module.css")).toMatch(/\.button\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("page and card padding are capped by screen width, because rem spacing grows with enlarged text", () => {
    expect(css("app/tokens.css")).toMatch(/--page-gutter:\s*min\(.*vw\)/);
    expect(css("ui/Card.module.css")).toMatch(/\.card\s*\{[^}]*padding:\s*min\(.*vw\)/);
  });
});

describe("the brand colour means 'you can act on this'", () => {
  it("labels (badges, notices) never use it, so a label cannot be mistaken for a button or link", () => {
    for (const file of ["ui/Badge.module.css", "ui/Notice.module.css"]) {
      expect(read(join(src, file)), file).not.toMatch(/--color-primary/);
    }
  });
});
