import { t } from "@/i18n/messages";
import type { ApplicantForm } from "@/admissions/model";

import { firstProblem, type ImportRow, type RowResult } from "./student-import";

/** How a failed try is picked up again: what it may have left behind, and how to finish it. */
export interface Recovery {
  /** The waiting walk-in applications for this student (same name and sign-in email) in this class's level: their ids. Null when it cannot be asked. */
  pendingApplications: (values: ApplicantForm) => Promise<string[] | null>;
  /** Approves one of them into the class. "conflict" means it was approved already (an answer was lost on the way). */
  approve: (applicationId: string) => Promise<
    | { ok: true; sid: string; temporaryPassword: string }
    | { ok: false; reason: "conflict" | "failed" | "forbidden" | "not_found" }
    | { ok: false; reason: "invalid"; message: string }
  >;
  /** The students of this class with this name: id and student ID. Null when it cannot be asked. */
  studentsNamed: (values: ApplicantForm) => Promise<{ id: string; sid: string }[] | null>;
  /** A new password for that student (shown once); null when it cannot be made. */
  newPassword: (studentId: string) => Promise<string | null>;
}

/** What the import needs from the rest of the app: the things it asks of the server, one student at a time. */
export interface AdmitDeps {
  /** A Nepali date as an English one; `ok: false` when it is not a real day. */
  toAd: (bs: string) => Promise<{ ok: true; ad: string } | { ok: false; error: "dateUnverified" | "dateInvalid" | "failed" }>;
  /** The sign-in email a first and last name would get (first.last@student.com, numbered when taken); null when it cannot be asked. */
  suggestEmail: (firstName: string, lastName: string) => Promise<string | null>;
  /** "failed" is a busy or unreachable server: the answer is not known, so the same student is tried again. */
  walkIn: (values: ApplicantForm, ad: string, confirmDuplicate: boolean) => Promise<
    | { ok: true; sid: string; temporaryPassword: string }
    | { ok: false; reason: "duplicate"; matches: { name: string; sid: string }[] }
    | { ok: false; reason: "invalid"; message: string }
    | { ok: false; reason: "forbidden" | "not_found" | "failed" }
  >;
  /** Finds and finishes what a failed try left (D-151). Without it a busy server is still waited out, but nothing is looked for. */
  recovery?: Recovery;
  /** Waits that many milliseconds; the screen's is a real timer, a test's is instant. */
  wait?: (ms: number) => Promise<void>;
}

/** How long to wait after each busy answer: it grows, then stays at half a minute. Nine tries in all, about two and a half minutes. */
export const WAITS_MS: readonly number[] = [2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000];
/** The extra pause between students after a busy answer: it doubles from 1.5 s up to 8 s, and goes after five clean ones in a row. */
export const SLOW_FIRST_MS = 1500;
export const SLOW_MAX_MS = 8000;
export const CLEAN_TO_EASE = 5;
/** The waits between the tries of one approval inside a recovery. */
const APPROVE_WAITS_MS: readonly number[] = [2000, 4000, 8000, 15000];

const nameOf = (v: ApplicantForm): string => [v.firstName, v.middleName, v.lastName].filter(Boolean).join(" ");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Done = Extract<RowResult, { status: "admitted" | "problem" }>;

export interface AdmitOptions {
  confirmDuplicate?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** The server is busy: which student, and which try is next. */
  onWait?: (info: { line: number; attempt: number; of: number }) => void;
  /** Each student's result as soon as it is known, so the sign-in sheet can be saved before the end. */
  onResult?: (result: RowResult) => void;
  /** After a reload: the student the stopped import was on may have got in, so look for them before sending anyone (D-161). */
  checkFirst?: boolean;
  /** A pause after each student, to be gentle with the server. It stretches after a busy answer and eases back (D-160). */
  pauseMs?: number;
  /** Student IDs that were in the class before the run: never taken for a student the run itself admitted. */
  known?: ReadonlySet<string>;
}

/**
 * Admits the rows of a class list one after another (the PM, 2026-10-11), the same way the quick form admits one: each is its
 * own all-or-nothing admission with its own student ID, login and temporary password. One at a time, so the numbers and the
 * emails come out in the order of the sheet and a failure in one row never touches another. A row with a problem in the sheet
 * is not sent. A possible duplicate is not admitted unless `confirmDuplicate`; it is reported, and can be admitted on purpose.
 *
 * Keeps going until every student is in (the PM, 2026-10-12, D-151). When the server is busy (a 503, a timeout) it waits, then
 * looks for what the failed try left: a waiting application, which it approves, or a student whose answer was lost, who gets a
 * new password. Only when neither is there is the student sent again, so nobody is admitted twice.
 */
export async function admitRows(deps: AdmitDeps, rows: readonly ImportRow[], opts: AdmitOptions = {}): Promise<RowResult[]> {
  const wait = deps.wait ?? sleep;
  const taken = new Set(opts.known ?? []);
  const results: RowResult[] = [];
  let slow = 0; // the extra pause between students while the server has been busy
  let clean = 0; // students in a row that went in on the first try
  const push = (result: RowResult) => {
    results.push(result);
    if (result.status === "admitted") taken.add(result.sid);
    opts.onResult?.(result);
  };

  // What a failed try may have left, finished: null when there is certainly nothing to finish, and "unknown" when it could not
  // be looked at (the busy server refused that too): then nothing is sent again, or a second copy would be made (D-159).
  async function recover(values: ApplicantForm, line: number, name: string): Promise<Done | "unknown" | null> {
    const rec = deps.recovery;
    if (!rec) return null;
    const admitted = (sid: string, password: string): Done => ({ line, name, status: "admitted", sid, email: values.email, password });
    const pending = await rec.pendingApplications(values);
    if (pending === null) return "unknown";
    for (const id of pending) {
      for (let attempt = 0; ; attempt++) {
        const approved = await rec.approve(id);
        if (approved.ok) return admitted(approved.sid, approved.temporaryPassword);
        if (approved.reason === "invalid") return { line, name, status: "problem", message: approved.message };
        if (approved.reason !== "failed" || attempt >= APPROVE_WAITS_MS.length) break;
        await wait(APPROVE_WAITS_MS[attempt]!);
      }
    }
    const students = await rec.studentsNamed(values);
    if (students === null) return "unknown";
    const fresh = students.filter((s) => !taken.has(s.sid));
    if (fresh.length > 0) {
      const password = await rec.newPassword(fresh[0]!.id);
      if (password) return admitted(fresh[0]!.sid, password);
    }
    return null;
  }

  for (const [index, row] of rows.entries()) {
    opts.onProgress?.(index, rows.length);
    const verifyFirst = index === 0 && opts.checkFirst === true;
    const name = nameOf(row.values);
    const problem = firstProblem(row);
    if (problem) {
      push({ line: row.line, name, status: "problem", message: t(problem) });
      continue;
    }
    let ad = "";
    if (row.values.dobBs !== "") {
      const converted = await deps.toAd(row.values.dobBs);
      if (!converted.ok) {
        push({ line: row.line, name, status: "problem", message: t(converted.error === "dateUnverified" ? "admissions.error.dobUnverified" : converted.error === "dateInvalid" ? "admissions.error.dobInvalid" : "admissions.error.failed") });
        continue;
      }
      ad = converted.ad;
    }
    // The email is made here, so the sign-in sheet can say it, and so a failed try's leftovers can be found by it.
    const values = { ...row.values, email: row.values.email || (await deps.suggestEmail(row.values.firstName, row.values.lastName)) || "" };

    let finished: RowResult | null = null;
    let unsure = verifyFirst; // what the last try left could not be looked at: wait and look again, do not send again
    for (let attempt = 0; finished === null; attempt++) {
      const outcome: Awaited<ReturnType<AdmitDeps["walkIn"]>> = unsure ? { ok: false, reason: "failed" } : await deps.walkIn(values, ad, opts.confirmDuplicate === true);
      if (outcome.ok) finished = { line: row.line, name, status: "admitted", sid: outcome.sid, email: values.email, password: outcome.temporaryPassword };
      else if (outcome.reason === "duplicate") finished = { line: row.line, name, status: "duplicate", matches: outcome.matches };
      else if (outcome.reason !== "failed") finished = { line: row.line, name, status: "problem", message: outcome.reason === "invalid" ? outcome.message : t("content.forbidden") };
      else if (attempt >= WAITS_MS.length) finished = { line: row.line, name, status: "problem", message: t("classes.import.gaveUp") };
      else {
        if (!(verifyFirst && attempt === 0)) {
          slow = Math.min(SLOW_MAX_MS, Math.max(slow * 2, SLOW_FIRST_MS));
          clean = -1; // this student did not go in on the first try
        }
        opts.onWait?.({ line: row.line, attempt: attempt + 1, of: WAITS_MS.length });
        await wait(WAITS_MS[attempt]!);
        const found = await recover(values, row.line, name);
        unsure = found === "unknown";
        finished = found === "unknown" ? null : found;
      }
    }
    push(finished);
    clean = clean < 0 ? 0 : clean + 1;
    if (clean >= CLEAN_TO_EASE) {
      slow = 0;
      clean = 0;
    }
    if (opts.pauseMs) await wait(opts.pauseMs + slow);
  }
  opts.onProgress?.(rows.length, rows.length);
  return results;
}
