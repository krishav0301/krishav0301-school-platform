import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { renderNumbered } from "../src/core/config/sql-render";

/**
 * A D1 database reached through the wrangler command line, for scripts that run on a developer's
 * machine against a local or deployed database (creating the first Super Admin, for instance).
 * It implements only what our services use: `prepare().bind().first/all/run` and `batch`. Because
 * the service code is unchanged, a user created this way goes through exactly the same checks and
 * the same audit chain as one created by a screen. A batch is sent as one multi-statement command,
 * which D1 runs all-or-nothing.
 *
 * Slow (one wrangler call per query, a few seconds each): for rare operator tasks, never for requests.
 */
type Param = string | number | null | undefined;

interface Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}

const wranglerBin = resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js");

function execute(options: { target: "--local" | "--remote"; config: string }, statements: string[]): Result[] {
  const command = statements.join(";\n");
  const run = spawnSync(process.execPath, [wranglerBin, "d1", "execute", "DB", options.target, "--config", options.config, "--json", "--command", command], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`wrangler d1 execute failed:\n${run.stderr || run.stdout}`);

  const start = run.stdout.indexOf("[");
  if (start === -1) throw new Error(`wrangler printed no JSON:\n${run.stdout}`);
  const parsed = JSON.parse(run.stdout.slice(start)) as Result[];
  if (parsed.length !== statements.length) throw new Error(`Expected ${statements.length} results, got ${parsed.length}.`);
  return parsed.map((r) => ({ results: r.results ?? [], success: r.success, meta: { changes: r.meta?.changes ?? 0, last_row_id: r.meta?.last_row_id ?? 0 } }));
}

export function wranglerD1(options: { target: "--local" | "--remote"; config: string }): D1Database {
  class Statement {
    constructor(
      readonly sql: string,
      readonly params: Param[] = [],
    ) {}
    bind(...params: Param[]) {
      return new Statement(this.sql, params);
    }
    rendered() {
      return renderNumbered(this.sql, this.params.map((p) => (p === undefined ? null : p)));
    }
    async run() {
      return execute(options, [this.rendered()])[0]!;
    }
    async all() {
      return execute(options, [this.rendered()])[0]!;
    }
    async first() {
      return execute(options, [this.rendered()])[0]!.results[0] ?? null;
    }
  }

  const database = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      return execute(options, statements.map((s) => s.rendered()));
    },
  };
  return database as unknown as D1Database;
}
