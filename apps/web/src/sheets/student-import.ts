import type { MessageKey } from "@/i18n/messages";
import { emptyApplicantForm, validateStaffApplicant, type ApplicantErrors, type ApplicantForm } from "@/admissions/model";

import { toCsv } from "./csv";
import { MAX_ROWS } from "./table";

/**
 * A class list from Excel (the PM, 2026-10-11): the Co-ordinator fills a sheet for one class, and each row becomes a
 * student admitted to it, the same as the quick form. Only the first name is needed; the rest is checked only when it is
 * given. The sheet is read here, in the browser; nothing but the admissions themselves is sent.
 */

type Field = Exclude<keyof ApplicantForm, "levelId">;

/** The columns of the template, in order: what the sheet says, and what it is. */
export const STUDENT_COLUMNS: readonly { field: Field; header: string; aliases: readonly string[] }[] = [
  { field: "firstName", header: "First name", aliases: ["first name", "firstname", "name", "student name", "full name", "given name"] },
  { field: "middleName", header: "Middle name", aliases: ["middle name", "middlename"] },
  { field: "lastName", header: "Last name", aliases: ["last name", "lastname", "surname", "family name"] },
  { field: "dobBs", header: "Date of birth (BS)", aliases: ["date of birth bs", "date of birth", "dob bs", "dob", "birth date", "birthdate"] },
  { field: "phone", header: "Phone", aliases: ["phone", "mobile", "contact", "phone number", "contact number"] },
  { field: "email", header: "Email", aliases: ["email", "email address", "e-mail"] },
  { field: "guardianName", header: "Guardian's name", aliases: ["guardian name", "guardians name", "guardian", "parent", "parent name", "father name", "fathers name"] },
  { field: "guardianPhone", header: "Guardian's phone", aliases: ["guardian phone", "guardians phone", "parent phone", "guardian contact", "parent contact"] },
  { field: "previousSchool", header: "Previous school", aliases: ["previous school", "last school", "previous school or college"] },
  { field: "referredBy", header: "Referred by", aliases: ["referred by", "reference", "referral"] },
];

/** A header as the words in it: lower case, apostrophes dropped (Father's becomes fathers), then letters and digits only, one space between. */
const words = (header: string): string =>
  header
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The template the Co-ordinator downloads: the headers, and one example row to show how a row looks. */
export function studentTemplateCsv(): string {
  return toCsv([STUDENT_COLUMNS.map((c) => c.header), ["Sita", "", "Sharma", "2065-01-19", "9801234567", "", "Ram Sharma", "9801234568", "", ""]]);
}

/** A Nepali date as typed, 2065-1-9 or 2065/01/09 or 2065.1.9, as 2065-01-09; null when it is not that shape. */
export function normaliseBsDate(text: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text.trim());
  return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : null;
}

export interface ImportRow {
  /** The row's line in the sheet, as Excel numbers it, so a message can point at it. */
  line: number;
  values: ApplicantForm;
  errors: ApplicantErrors;
}

export type ParsedStudents =
  | { ok: true; rows: ImportRow[]; ignored: string[] }
  | { ok: false; reason: "no_name_column" | "no_rows" | "too_many" };

/**
 * The rows of a sheet as students for the class whose level is `levelId`. The header row is the first one with a first-name
 * column; the rows above it are skipped. A column that is not one of the template's is ignored, and named so the person
 * knows. Each row is checked the way the quick form checks it.
 */
export function parseStudentSheet(table: readonly (readonly string[])[], levelId: string): ParsedStudents {
  const headerAt = table.findIndex((row) => row.some((c) => STUDENT_COLUMNS[0]!.aliases.includes(words(c))));
  if (headerAt < 0) return { ok: false, reason: "no_name_column" };
  const header = table[headerAt]!;
  const columns = new Map<number, Field>();
  const taken = new Set<Field>();
  const ignored: string[] = [];
  header.forEach((cell, index) => {
    const w = words(cell);
    if (w === "") return;
    const column = STUDENT_COLUMNS.find((c) => !taken.has(c.field) && c.aliases.includes(w));
    if (column) {
      columns.set(index, column.field);
      taken.add(column.field);
    } else ignored.push(cell.trim());
  });

  const rows: ImportRow[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const source = table[i]!;
    const values = emptyApplicantForm();
    values.levelId = levelId;
    columns.forEach((field, index) => {
      values[field] = (source[index] ?? "").trim();
    });
    if (STUDENT_COLUMNS.every((c) => values[c.field] === "")) continue;
    const errors = validateStaffApplicant(values);
    if (values.dobBs !== "") {
      const date = normaliseBsDate(values.dobBs);
      if (date === null) errors.dobBs = "admissions.error.dobInvalid";
      else values.dobBs = date;
    }
    rows.push({ line: i + 1, values, errors });
  }
  if (rows.length === 0) return { ok: false, reason: "no_rows" };
  if (rows.length > MAX_ROWS) return { ok: false, reason: "too_many" };
  return { ok: true, rows, ignored };
}

/** The first problem of a row, as a message key, for the preview; null when the row is fine. */
export const firstProblem = (row: ImportRow): MessageKey | null => (Object.values(row.errors).find((e) => e !== undefined) as MessageKey | undefined) ?? null;

/** What one row came to when it was admitted. */
export type RowResult =
  | { line: number; name: string; status: "admitted"; sid: string; email: string; password: string }
  | { line: number; name: string; status: "duplicate"; matches: { name: string; sid: string }[] }
  | { line: number; name: string; status: "problem"; message: string };

/**
 * The sign-in sheet for what was admitted: the student ID, name, sign-in email and temporary password, to hand out. The
 * passwords are shown once and are in this browser only; this is the one place they can be kept.
 */
export function loginsCsv(results: readonly RowResult[]): string {
  const rows = results.filter((r): r is Extract<RowResult, { status: "admitted" }> => r.status === "admitted");
  return toCsv([["Student ID", "Name", "Sign-in email", "Temporary password"], ...rows.map((r) => [r.sid, r.name, r.email, r.password])]);
}
