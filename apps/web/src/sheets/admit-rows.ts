import { t } from "@/i18n/messages";
import type { ApplicantForm } from "@/admissions/model";

import { firstProblem, type ImportRow, type RowResult } from "./student-import";

/** What the import needs from the rest of the app: the three things it asks of the server, one student at a time. */
export interface AdmitDeps {
  /** A Nepali date as an English one; `ok: false` when it is not a real day. */
  toAd: (bs: string) => Promise<{ ok: true; ad: string } | { ok: false; error: "dateUnverified" | "dateInvalid" | "failed" }>;
  /** The sign-in email a first name would get (name@student.com, numbered when taken); null when it cannot be asked. */
  suggestEmail: (firstName: string) => Promise<string | null>;
  walkIn: (values: ApplicantForm, ad: string, confirmDuplicate: boolean) => Promise<
    | { ok: true; sid: string; temporaryPassword: string }
    | { ok: false; reason: "duplicate"; matches: { name: string; sid: string }[] }
    | { ok: false; reason: "invalid"; message: string }
    | { ok: false; reason: "forbidden" | "not_found" | "failed" }
  >;
}

const nameOf = (v: ApplicantForm): string => [v.firstName, v.middleName, v.lastName].filter(Boolean).join(" ");

/**
 * Admits the rows of a class list one after another (the PM, 2026-10-11), the same way the quick form admits one: each is its
 * own all-or-nothing admission with its own student ID, login and temporary password. One at a time, so the numbers and the
 * emails come out in the order of the sheet and a failure in one row never touches another. A row with a problem in the sheet
 * is not sent. A possible duplicate is not admitted unless `confirmDuplicate`; it is reported, and can be admitted on purpose.
 */
export async function admitRows(deps: AdmitDeps, rows: readonly ImportRow[], opts: { confirmDuplicate?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<RowResult[]> {
  const results: RowResult[] = [];
  for (const [index, row] of rows.entries()) {
    opts.onProgress?.(index, rows.length);
    const name = nameOf(row.values);
    const problem = firstProblem(row);
    if (problem) {
      results.push({ line: row.line, name, status: "problem", message: t(problem) });
      continue;
    }
    let ad = "";
    if (row.values.dobBs !== "") {
      const converted = await deps.toAd(row.values.dobBs);
      if (!converted.ok) {
        results.push({ line: row.line, name, status: "problem", message: t(converted.error === "dateUnverified" ? "admissions.error.dobUnverified" : converted.error === "dateInvalid" ? "admissions.error.dobInvalid" : "admissions.error.failed") });
        continue;
      }
      ad = converted.ad;
    }
    // The email is made here, so the sign-in sheet can say it: the server would make the same one.
    const values = { ...row.values, email: row.values.email || (await deps.suggestEmail(row.values.firstName)) || "" };
    const outcome = await deps.walkIn(values, ad, opts.confirmDuplicate === true);
    if (outcome.ok) results.push({ line: row.line, name, status: "admitted", sid: outcome.sid, email: values.email, password: outcome.temporaryPassword });
    else if (outcome.reason === "duplicate") results.push({ line: row.line, name, status: "duplicate", matches: outcome.matches });
    else results.push({ line: row.line, name, status: "problem", message: outcome.reason === "invalid" ? outcome.message : t(outcome.reason === "forbidden" ? "content.forbidden" : "admissions.error.failed") });
  }
  opts.onProgress?.(rows.length, rows.length);
  return results;
}
