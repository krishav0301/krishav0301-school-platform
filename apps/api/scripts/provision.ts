import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { InvalidPackError, packOperations, parsePack, renderSql } from "../src/core/config";

/**
 * Sets up one school's database from its pack:
 *   npm run provision -- --pack ../../packs/royal-softech --local
 *   npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.local.jsonc
 *   npm run provision -- --pack ../../packs/royal-softech --print      (only shows the SQL)
 *
 * It checks the pack first and refuses a bad one before touching any database. Then it applies the
 * migrations and the pack. Both steps are safe to run again. This is provisioning, not a user
 * action, so it is not recorded in the audit log; the pack file in git is its record (D-026).
 */
function parseArguments(argv: string[]) {
  const options = { pack: "", config: "wrangler.jsonc", target: "" as "" | "--local" | "--remote", print: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--pack") options.pack = argv[++i] ?? "";
    else if (arg === "--config") options.config = argv[++i] ?? "";
    else if (arg === "--local" || arg === "--remote") options.target = arg;
    else if (arg === "--print") options.print = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pack) throw new Error("Give the pack folder: --pack ../../packs/<school>");
  if (!options.print && !options.target) throw new Error("Say where: --local or --remote (or --print to only show the SQL)");
  return options;
}

function wrangler(args: string[]) {
  // Run wrangler with node directly: no shell, so nothing is re-parsed or left unescaped.
  const wranglerBin = resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [wranglerBin, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const packFile = resolve(options.pack, "pack.json");

  let pack;
  try {
    pack = parsePack(JSON.parse(readFileSync(packFile, "utf8")));
  } catch (error) {
    if (error instanceof InvalidPackError) {
      console.error(`${packFile} is not a valid pack:\n${error.problems.map((p) => `  - ${p}`).join("\n")}`);
      process.exit(1);
    }
    throw error;
  }

  const sql = renderSql(packOperations(pack));
  if (options.print) {
    console.warn(sql);
    return;
  }

  const file = join(mkdtempSync(join(tmpdir(), "provision-")), "pack.sql");
  writeFileSync(file, sql + "\n");
  console.warn(`Pack "${pack.school.name}" is valid. Applying to ${options.target.slice(2)} database.`);

  wrangler(["d1", "migrations", "apply", "DB", options.target, "--config", options.config]);
  wrangler(["d1", "execute", "DB", options.target, "--config", options.config, "--file", file]);
  console.warn("Done.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
