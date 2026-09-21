import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { t } from "@/i18n/messages";
import { SITE_LINKS, isHere } from "@/shell/site-links";

/**
 * The addresses the Worker fills in, read from the source of `PAGES` the way `scripts/check-boundaries.mjs` does.
 * (Importing the API's module here would pull Cloudflare types into the web project.)
 */
const filledPages = (): string[] => {
  const source = readFileSync(join(import.meta.dirname, "..", "..", "api", "src", "modules", "site", "pages.ts"), "utf8");
  const block = /const PAGES: Record<string, Builder> = \{([^}]*)\}/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]!);
};

describe("the links to the public pages", () => {
  it("are the pages the Worker fills in, except Home (the school's name is that link), in reading order", () => {
    expect(filledPages().length).toBeGreaterThan(5); // the pattern above really found the list
    expect(SITE_LINKS.map((l) => l.href)).toEqual(["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"]);
    expect(SITE_LINKS.map((l) => l.href).sort()).toEqual(filledPages().filter((p) => p !== "/").sort());
  });

  it("each has a label from the catalog", () => {
    expect(SITE_LINKS.map((l) => t(l.labelKey))).toEqual(["Programmes", "Admission", "Scholarships", "Facilities", "Contact", "Notices and updates"]);
  });
});

describe("isHere", () => {
  it("is true on the page itself, with or without a trailing slash", () => {
    expect(isHere("/programmes", "/programmes")).toBe(true);
    expect(isHere("/programmes/", "/programmes")).toBe(true);
  });

  it("is false on every other page, on Home, and before the address is known", () => {
    expect(isHere("/admission", "/programmes")).toBe(false);
    expect(isHere("/", "/programmes")).toBe(false);
    expect(isHere("/programmes-old", "/programmes")).toBe(false);
    expect(isHere(null, "/programmes")).toBe(false);
  });
});
