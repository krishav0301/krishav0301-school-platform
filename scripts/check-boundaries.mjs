#!/usr/bin/env node
/**
 * Keeps the layers honest (D-008). Run in CI. Rules:
 *   1. src/core never imports from src/modules.
 *   2. A module never imports another module's internals (only its `index`, or its `service`).
 *   3. Nothing under apps/api/src refers to `packs/`: the core does not know any school.
 *   4. Nothing under apps/api/src or apps/web/src names a specific school.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiSrc = join(root, "apps", "api", "src");
const webSrc = join(root, "apps", "web", "src");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield path;
  }
}

const importPattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const problems = [];

for (const file of files(apiSrc)) {
  const text = readFileSync(file, "utf8");
  const rel = relative(apiSrc, file).split(sep).join("/");
  const layer = rel.split("/")[0];
  const moduleName = layer === "modules" ? rel.split("/")[1] : null;

  for (const [, spec] of text.matchAll(importPattern)) {
    if (!spec.startsWith(".")) continue;
    const target = relative(apiSrc, resolve(dirname(file), spec)).split(sep).join("/");
    const parts = target.split("/");

    if (layer === "core" && parts[0] === "modules") problems.push(`${rel}: core must not import modules (${spec})`);
    if (moduleName && parts[0] === "modules" && parts[1] !== moduleName && parts[2] && !["index", "service"].includes(parts[2].replace(/\.ts$/, ""))) {
      problems.push(`${rel}: reaches into another module's internals (${spec}); use its index or service`);
    }
    if (spec.includes("packs/") || spec.includes("packs\\")) problems.push(`${rel}: source must not import from packs/ (${spec})`);
  }
}

// Rule 4: no school is named in the product code.
const schoolNames = [/royal\s*softech/i, /\blahan\b/i, /\bsiraha\b/i];
for (const dir of [apiSrc, webSrc]) {
  for (const file of files(dir)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of schoolNames) {
      if (pattern.test(text)) problems.push(`${relative(root, file)}: names a specific school (${pattern}); that belongs in a pack`);
    }
  }
}

// Rule 5 (D-046): the public pages the Worker fills in, and the three crawler files it writes (robots.txt,
// sitemap.xml, llms.txt), must be listed twice, and the lists must agree.
// `PAGES` and `CRAWLER_FILES` (the code) say which addresses the Worker answers; `run_worker_first`
// (wrangler.jsonc) is what makes Cloudflare send those addresses to the Worker instead of serving the
// static file. An address in only one list would silently be served without its words.
{
  const pagesSource = readFileSync(join(apiSrc, "modules", "site", "pages.ts"), "utf8");
  const block = /const PAGES: Record<string, Builder> = \{([^}]*)\}/.exec(pagesSource)?.[1] ?? "";
  const filesSource = readFileSync(join(apiSrc, "modules", "site", "crawler-files.ts"), "utf8");
  const filesBlock = /export const CRAWLER_FILES = \[([^\]]*)\]/.exec(filesSource)?.[1] ?? "";
  const inCode = [...block.matchAll(/"([^"]+)"\s*:/g), ...filesBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  const wrangler = readFileSync(join(root, "apps", "api", "wrangler.jsonc"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  const first = /"run_worker_first"\s*:\s*\[([^\]]*)\]/.exec(wrangler)?.[1] ?? "";
  const inConfig = [...first.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "/api/*").sort();

  if (inCode.length === 0) problems.push("modules/site/pages.ts: could not read the list of filled pages (PAGES)");
  if (JSON.stringify(inCode) !== JSON.stringify(inConfig)) {
    problems.push(`public addresses differ: PAGES and CRAWLER_FILES have [${inCode.join(", ")}] but run_worker_first in wrangler.jsonc has [${inConfig.join(", ")}] besides /api/*`);
  }
  if (!first.includes('"/api/*"')) problems.push('wrangler.jsonc: run_worker_first must keep "/api/*"');
}

if (problems.length > 0) {
  console.error(`Layer boundaries broken:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.warn("Layer boundaries hold.");
