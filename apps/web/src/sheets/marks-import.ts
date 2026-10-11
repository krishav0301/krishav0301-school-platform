import { formatMarks, markKey, markText, parseMark, type MarkSheet } from "@/results/model";

import { toCsv } from "./csv";

/**
 * A subject's marks from Excel, for one class and one exam (the PM, 2026-10-11). The teacher downloads a sheet with the
 * class already listed (and any marks already entered), fills it in Excel, and uploads it: the marks fill the grid, and the
 * teacher checks them, saves and sends them for review as always. Nothing is saved by the upload itself. Students are
 * matched by their student ID, never by name or by row, so a re-sorted sheet still lands on the right student.
 */

type Component = MarkSheet["components"][number];

const partWord = (c: Component): string => (c.id === "practical" ? "Practical" : "Theory");

/** The template: one row a student, the ID and name to find them by, a column for each part, out of what it is out of. */
export function marksTemplateCsv(sheet: MarkSheet): string {
  const header = ["Student ID", "Name", ...sheet.components.map((c) => `${partWord(c)} (out of ${formatMarks(c.maxHundredths)})`)];
  const rows = sheet.students.map((s) => [s.sid, s.name, ...sheet.components.map((c) => markText(s.marks.find((m) => m.componentId === c.id) ?? { valueHundredths: null, absent: false }))]);
  return toCsv([header, ...rows]);
}

/** A header as its words, lower case, letters and digits only. */
const words = (cell: string): string =>
  cell
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface MarkProblem {
  sid: string;
  name: string;
  part: string;
  text: string;
  reason: "not_a_mark" | "over_max";
}

export type MarksImport =
  | {
      ok: true;
      /** The marks to put in the grid, by the grid's own keys, as the text a person would have typed. */
      draft: Record<string, string>;
      /** Students whose row gave at least one mark. */
      filled: number;
      /** Student IDs in the sheet that are not in this class. */
      notFound: string[];
      /** Students of the class the sheet had no row for. */
      missingRows: number;
      problems: MarkProblem[];
    }
  | { ok: false; reason: "no_id_column" | "no_mark_columns" | "no_rows" };

/** What a sheet of marks puts into the grid: only the valid marks, the rest reported. */
export function parseMarksSheet(table: readonly (readonly string[])[], sheet: MarkSheet): MarksImport {
  const headerAt = table.findIndex((row) => row.some((c) => ["student id", "studentid", "sid", "id"].includes(words(c))));
  if (headerAt < 0) return { ok: false, reason: "no_id_column" };
  const header = table[headerAt]!;
  const idColumn = header.findIndex((c) => ["student id", "studentid", "sid", "id"].includes(words(c)));
  // A column for each part: the one that begins with Theory (or Practical).
  const columnOf = new Map<Component["id"], number>();
  for (const c of sheet.components) {
    const at = header.findIndex((cell) => words(cell).startsWith(partWord(c).toLowerCase()));
    if (at >= 0) columnOf.set(c.id, at);
  }
  if (columnOf.size === 0) return { ok: false, reason: "no_mark_columns" };

  const byId = new Map(sheet.students.map((s) => [s.sid.trim().toLowerCase(), s]));
  const draft: Record<string, string> = {};
  const notFound: string[] = [];
  const problems: MarkProblem[] = [];
  const seen = new Set<string>();
  let rows = 0;
  for (let i = headerAt + 1; i < table.length; i++) {
    const row = table[i]!;
    const sid = (row[idColumn] ?? "").trim();
    if (sid === "") continue;
    rows++;
    const student = byId.get(sid.toLowerCase());
    if (!student) {
      notFound.push(sid);
      continue;
    }
    let gave = false;
    for (const c of sheet.components) {
      const at = columnOf.get(c.id);
      const text = at === undefined ? "" : (row[at] ?? "").trim();
      if (text === "") continue;
      const parsed = parseMark(text);
      const problem = (reason: MarkProblem["reason"]) => problems.push({ sid: student.sid, name: student.name, part: partWord(c), text, reason });
      if (parsed === null) problem("not_a_mark");
      else if (parsed.valueHundredths !== null && parsed.valueHundredths > c.maxHundredths) problem("over_max");
      else {
        draft[markKey(student.enrollmentId, c.id)] = parsed.absent ? "AB" : text.replace(/^0+(?=\d)/, "");
        gave = true;
      }
    }
    if (gave) seen.add(student.enrollmentId);
  }
  if (rows === 0) return { ok: false, reason: "no_rows" };
  return { ok: true, draft, filled: seen.size, notFound, missingRows: sheet.students.filter((s) => !table.some((r, i) => i > headerAt && (r[idColumn] ?? "").trim().toLowerCase() === s.sid.trim().toLowerCase())).length, problems };
}
