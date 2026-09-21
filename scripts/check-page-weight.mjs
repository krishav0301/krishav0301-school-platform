#!/usr/bin/env node
/**
 * Page-weight budgets (Phase 2, slice 5, D-055). Run in CI after the production build:
 *
 *   node ../../scripts/check-page-weight.mjs --out out --budget page-weight-budget.json
 *
 * For each public page it measures what a visitor's browser downloads to show it: the page's own HTML, and the
 * scripts and styles the HTML refers to, each compressed with Brotli (quality 5, close to what Cloudflare sends).
 * It fails when a page goes over its budget, so a page cannot quietly grow. Fonts are not counted: they load only
 * for the characters a page uses, and the theme picks one.
 *
 * The budget file lists the public pages (`pages`), the pages that are not public (`ignore`), and three numbers in KB:
 * `htmlKb` (a page's own HTML), `assetsKb` (its scripts and styles together) and `scriptKb` (its largest script).
 * A page that is in the build but in neither list fails too, so a new page must be given a budget or set aside on purpose.
 *
 * Exit codes: 0 all inside budget, 1 a budget is broken, 2 the check itself could not run (bad arguments or budget).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const brotli = (buffer) => brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
const kb = (bytes) => bytes / 1024;
const fmt = (bytes) => `${kb(bytes).toFixed(1)} KB`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArguments(argv) {
  const options = { out: "", budget: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") options.out = argv[++i] ?? "";
    else if (argv[i] === "--budget") options.budget = argv[++i] ?? "";
    else fail(`Unknown argument: ${argv[i]}`);
  }
  if (!options.out || !options.budget) fail("Usage: check-page-weight.mjs --out <build folder> --budget <budget file>");
  return options;
}

function readBudget(file) {
  let budget;
  try {
    budget = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Cannot read the budget file ${file}: ${error instanceof Error ? error.message : error}`);
  }
  for (const key of ["htmlKb", "assetsKb", "scriptKb"]) {
    if (typeof budget[key] !== "number" || !(budget[key] > 0)) fail(`The budget file needs a positive number for ${key}.`);
  }
  if (!Array.isArray(budget.pages) || budget.pages.length === 0) fail("The budget file needs a list of pages.");
  return { ...budget, ignore: Array.isArray(budget.ignore) ? budget.ignore : [] };
}

/** Every HTML file in the build, as a page name ("programmes", "portal/content"), skipping the build's own folder. */
function htmlPages(root, folder = "") {
  const pages = [];
  for (const name of readdirSync(join(root, folder))) {
    const relative = folder ? `${folder}/${name}` : name;
    if (statSync(join(root, relative)).isDirectory()) {
      if (name !== "_next") pages.push(...htmlPages(root, relative));
    } else if (name.endsWith(".html")) {
      pages.push(relative.slice(0, -".html".length));
    }
  }
  return pages;
}

function measure(root, page, problems) {
  const html = readFileSync(join(root, `${page}.html`));
  const references = [...new Set([...html.toString("utf8").matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  let assets = 0;
  let largestScript = 0;
  for (const reference of references) {
    const file = join(root, reference);
    if (!existsSync(file)) {
      problems.push(`${page}: refers to ${reference}, which is not in the build`);
      continue;
    }
    const size = brotli(readFileSync(file));
    assets += size;
    if (reference.endsWith(".js")) largestScript = Math.max(largestScript, size);
  }
  return { html: brotli(html), assets, largestScript };
}

const { out, budget: budgetFile } = parseArguments(process.argv.slice(2));
const budget = readBudget(budgetFile);
if (!existsSync(out)) fail(`The build folder ${out} does not exist. Run the production build first.`);

const problems = [];
const inBuild = htmlPages(out);
for (const page of inBuild) {
  if (!budget.pages.includes(page) && !budget.ignore.includes(page)) {
    problems.push(`${page}: in the build but not in the budget (add it to "pages", or to "ignore" if it is not public)`);
  }
}

console.log(`Page weight, compressed. Budgets: HTML ${budget.htmlKb} KB, scripts and styles ${budget.assetsKb} KB, largest script ${budget.scriptKb} KB.`);
console.log(`${"page".padEnd(18)}${"HTML".padStart(10)}${"scripts+styles".padStart(16)}${"largest script".padStart(16)}`);
for (const page of budget.pages) {
  if (!inBuild.includes(page)) {
    problems.push(`${page}: listed in the budget but not in the build`);
    continue;
  }
  const m = measure(out, page, problems);
  console.log(`${page.padEnd(18)}${fmt(m.html).padStart(10)}${fmt(m.assets).padStart(16)}${fmt(m.largestScript).padStart(16)}`);
  if (kb(m.html) > budget.htmlKb) problems.push(`${page}: HTML is ${fmt(m.html)}, over its ${budget.htmlKb} KB budget`);
  if (kb(m.assets) > budget.assetsKb) problems.push(`${page}: scripts and styles are ${fmt(m.assets)}, over their ${budget.assetsKb} KB budget`);
  if (kb(m.largestScript) > budget.scriptKb) problems.push(`${page}: largest script is ${fmt(m.largestScript)}, over its ${budget.scriptKb} KB budget`);
}

if (problems.length > 0) {
  console.error(`\nPage-weight budget broken:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nEvery public page is inside its budget.");
