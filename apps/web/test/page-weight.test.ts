import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The page-weight budgets (Phase 2, slice 5): `scripts/check-page-weight.mjs` measures each public page's compressed
 * weight in the production build and fails CI when a page goes over its budget. These tests run the real script
 * against small fake builds. Random bytes do not compress, so a file's size is the size the script sees.
 */
const script = join(import.meta.dirname, "..", "..", "..", "scripts", "check-page-weight.mjs");
const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

type Budget = { pages: string[]; ignore?: string[]; htmlKb: number; assetsKb: number; scriptKb: number };
const KB = 1024;

interface Build {
  /** Page name to the files it references, each with a size in KB. */
  pages: Record<string, { htmlKb?: number; files?: { name: string; kb: number }[] }>;
  /** Extra HTML files that are not public pages (404, the portal). */
  extra?: string[];
}

function run(build: Build, budget: Budget) {
  const root = mkdtempSync(join(tmpdir(), "weight-"));
  roots.push(root);
  const out = join(root, "out");
  const write = (path: string, data: Buffer | string) => {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), data);
  };
  for (const [page, spec] of Object.entries(build.pages)) {
    const refs = (spec.files ?? []).map((f) => (f.name.endsWith(".css") ? `<link rel="stylesheet" href="/_next/static/chunks/${f.name}"/>` : `<script src="/_next/static/chunks/${f.name}" async=""></script>`)).join("");
    // The page's own markup is random too, padded to the size asked for.
    const padding = randomBytes(Math.round((spec.htmlKb ?? 1) * KB)).toString("base64").slice(0, Math.round((spec.htmlKb ?? 1) * KB * 0.75));
    write(`${page}.html`, `<html><head>${refs}</head><body>${padding}</body></html>`);
    for (const f of spec.files ?? []) write(`_next/static/chunks/${f.name}`, randomBytes(Math.round(f.kb * KB)));
  }
  for (const extra of build.extra ?? []) write(`${extra}.html`, "<html></html>");
  const budgetFile = join(root, "budget.json");
  writeFileSync(budgetFile, JSON.stringify(budget));
  const result = spawnSync(process.execPath, [script, "--out", out, "--budget", budgetFile], { encoding: "utf8" });
  return { code: result.status, text: `${result.stdout}${result.stderr}` };
}

const budget: Budget = { pages: ["index", "about"], ignore: ["404"], htmlKb: 4, assetsKb: 20, scriptKb: 12 };
const fine: Build = {
  pages: {
    index: { htmlKb: 2, files: [{ name: "app.js", kb: 10 }, { name: "site.css", kb: 3 }] },
    about: { htmlKb: 2, files: [{ name: "app.js", kb: 10 }, { name: "site.css", kb: 3 }] },
  },
  extra: ["404"],
};

describe("the page-weight check", () => {
  it("passes a build that is inside every budget, and says what each page weighs", () => {
    const { code, text } = run(fine, budget);
    expect(code, text).toBe(0);
    expect(text).toContain("index");
    expect(text).toContain("about");
  });

  it("fails when a page's own HTML is over, and names the page and the budget", () => {
    const { code, text } = run({ ...fine, pages: { ...fine.pages, about: { htmlKb: 9, files: fine.pages.about!.files! } } }, budget);
    expect(code).toBe(1);
    expect(text).toMatch(/about.*HTML.*over/i);
  });

  it("fails when a page's scripts and styles together are over", () => {
    const heavy = { htmlKb: 2, files: [{ name: "app.js", kb: 11 }, { name: "more.js", kb: 11 }] };
    const { code, text } = run({ ...fine, pages: { ...fine.pages, index: heavy } }, budget);
    expect(code).toBe(1);
    expect(text).toMatch(/index.*scripts and styles.*over/i);
  });

  it("fails when one script is over, even if the total is fine", () => {
    const { code, text } = run({ ...fine, pages: { ...fine.pages, index: { htmlKb: 2, files: [{ name: "big.js", kb: 13 }] } } }, budget);
    expect(code).toBe(1);
    expect(text).toMatch(/index.*largest script.*over/i);
  });

  it("counts what a page really sends: compressed, not the size on disk", () => {
    // 200 KB of repeated text compresses to almost nothing, so it is well inside a 12 KB script budget.
    const root = mkdtempSync(join(tmpdir(), "weight-"));
    roots.push(root);
    const out = join(root, "out");
    mkdirSync(join(out, "_next", "static", "chunks"), { recursive: true });
    writeFileSync(join(out, "index.html"), `<html><head><script src="/_next/static/chunks/a.js"></script></head></html>`);
    writeFileSync(join(out, "_next", "static", "chunks", "a.js"), "const x = 1;\n".repeat(20000));
    writeFileSync(join(root, "budget.json"), JSON.stringify({ pages: ["index"], htmlKb: 4, assetsKb: 20, scriptKb: 12 }));
    const result = spawnSync(process.execPath, [script, "--out", out, "--budget", join(root, "budget.json")], { encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("fails when a budgeted page is missing from the build, so a renamed page cannot slip out of the check", () => {
    const { code, text } = run({ pages: { index: fine.pages.index! } }, budget);
    expect(code).toBe(1);
    expect(text).toMatch(/about.*not in the build/i);
  });

  it("fails on a page that is in the build but in neither list, so a new page has to be given a budget or ignored on purpose", () => {
    const { code, text } = run({ ...fine, extra: ["404", "brand-new"] }, budget);
    expect(code).toBe(1);
    expect(text).toMatch(/brand-new.*not in the budget/i);
  });

  it("does not measure the pages it is told to ignore", () => {
    const { code } = run({ ...fine, extra: ["404"] }, budget);
    expect(code).toBe(0);
  });

  it("fails on a page that points to a script the build does not contain", () => {
    const root = mkdtempSync(join(tmpdir(), "weight-"));
    roots.push(root);
    const out = join(root, "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "index.html"), `<html><head><script src="/_next/static/chunks/missing.js"></script></head></html>`);
    writeFileSync(join(root, "budget.json"), JSON.stringify({ pages: ["index"], htmlKb: 4, assetsKb: 20, scriptKb: 12 }));
    const result = spawnSync(process.execPath, [script, "--out", out, "--budget", join(root, "budget.json")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/missing\.js/);
  });

  it("refuses a budget file that is missing a number, rather than checking against nothing", () => {
    const { code, text } = run(fine, { pages: ["index"], htmlKb: 4, assetsKb: 20 } as unknown as Budget);
    expect(code).toBe(2);
    expect(text).toMatch(/scriptKb/);
  });
});
