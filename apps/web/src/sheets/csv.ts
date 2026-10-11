/**
 * Reading and writing the plain text spreadsheets (CSV) that Excel opens and saves (the PM, 2026-10-11). A small reader
 * and writer for RFC 4180: quotes, a quote written twice, commas and line breaks inside quotes. Excel in some regions
 * separates with a semicolon, so the reader looks at the first line to decide. No library: this is all it has to do.
 */

/** Rows of text from the contents of a CSV file. A byte-order mark is dropped; a row with nothing in it is not a row. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const separator = semicolons > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) endCell();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** A cell for a spreadsheet: quoted, and never read as a formula (a text that starts with = + - @ is shown as text). */
const cell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** CSV text Excel opens as it is written: a byte-order mark for the letters, quotes round every cell, one line to a row. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
