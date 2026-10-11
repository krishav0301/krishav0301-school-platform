import { parseCsv } from "./csv";

/**
 * A spreadsheet the person chose, as rows of text (the PM, 2026-10-11): an Excel file (.xlsx) or a CSV. Excel is read in
 * the browser by `read-excel-file`, loaded only when a file is chosen so no other page carries it; nothing is uploaded.
 */

export type Cell = string | number | boolean | Date | null | undefined;

/** The most rows one import takes: a class, with room to spare. */
export const MAX_ROWS = 300;

/**
 * One cell as the text the person typed. Excel turns a date typed as 2065-01-19 into a date, so a date comes back as the
 * year, month and day as they were typed (the Nepali date the person meant), not converted.
 */
export function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "boolean") return "";
  return String(value).trim();
}

/** Rows of cells as rows of text, without the rows that have nothing in them. */
export function toTable(rows: readonly (readonly Cell[])[]): string[][] {
  return rows.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ""));
}

export type ReadFailure = "unsupported" | "unreadable";

/** Reads the chosen file: .xlsx (Excel) or .csv. A failure says which kind, never throws. */
export async function readTable(file: File): Promise<{ ok: true; rows: string[][] } | { ok: false; reason: ReadFailure }> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".csv") || name.endsWith(".txt")) return { ok: true, rows: parseCsv(await file.text()) };
    if (name.endsWith(".xlsx")) {
      const { readSheet } = await import("read-excel-file/browser");
      return { ok: true, rows: toTable((await readSheet(file)) as Cell[][]) };
    }
    return { ok: false, reason: "unsupported" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
