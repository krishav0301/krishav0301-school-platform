import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GROUP_NOTES, MATRIX, ROLE_CODES, showCell } from "../src/core/permissions";

/**
 * Rewrites the tables in docs/permission-matrix.md from the matrix in code, so the document
 * cannot drift from what the system enforces. CI runs this and fails if the file changes.
 */
const BEGIN = "<!-- BEGIN GENERATED: tables (run `npm run gen:permissions` in apps/api; do not edit by hand) -->";
const END = "<!-- END GENERATED -->";

const groups = [...new Set(MATRIX.map((row) => row.group))];

const tables = groups
  .map((group) => {
    const rows = MATRIX.filter((row) => row.group === group);
    const note = GROUP_NOTES[group];
    const header = `| Action | ${ROLE_CODES.join(" | ")} | Phase |`;
    const divider = `|---|${ROLE_CODES.map(() => "---").join("|")}|---|`;
    const lines = rows.map(
      (row) => `| ${row.label} (\`${row.id}\`) | ${ROLE_CODES.map((code) => showCell(row, code)).join(" | ")} | ${row.phase} |`,
    );
    return [`### ${group}`, ...(note ? ["", note] : []), "", header, divider, ...lines].join("\n");
  })
  .join("\n\n");

const target = resolve(import.meta.dirname, "../../../docs/permission-matrix.md");
const text = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
const start = text.indexOf(BEGIN);
const end = text.indexOf(END);
if (start === -1 || end === -1 || end < start) throw new Error(`Markers not found in ${target}`);

const next = `${text.slice(0, start)}${BEGIN}\n\n${tables}\n\n${text.slice(end)}`;
writeFileSync(target, next);
console.warn(`updated ${target}: ${MATRIX.length} actions in ${groups.length} groups`);
