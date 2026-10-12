"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import { useSession } from "@/session/SessionProvider";
import { saveFile } from "@/sheets/download";
import type { ImportRow, RowResult } from "@/sheets/student-import";

/**
 * The class import as something that lives beside the page (the PM, 2026-10-12, D-155): it keeps running when its pop-up is
 * closed or the person goes to another page of the portal, shows in the top bar with its progress, and opens again where it
 * was. One at a time. A reload or closing the tab stops it, and the browser asks first; what it had done is kept in this tab
 * and offered again as "Continue" (D-161).
 *
 * This file is in every page of the site (the provider sits at the root), so it imports nothing heavy: the code that admits
 * students is loaded only when an import starts, which keeps the public pages inside their page-weight budget.
 */
export interface ImportJob {
  /** Who started it: another person signing in on the same tab never sees it. */
  userId: string;
  classId: string;
  levelId: string;
  className: string;
  /** Every row of the sheet, kept so a possible duplicate can be admitted on purpose, and an interrupted import continued. */
  rows: ImportRow[];
  total: number;
  /** Students this pass is not going to send, because an earlier pass finished them (a continued import). */
  offset: number;
  done: number;
  waiting: { attempt: number; of: number } | null;
  /** Each student's result as it comes, so the sign-in sheet can be saved before the end. */
  live: RowResult[];
  /** Everything the class import has come to (earlier passes included); null while the first pass runs. */
  results: RowResult[] | null;
  running: boolean;
  /** The tab was reloaded or closed while it ran: what it had done is shown, and it can be continued. */
  interrupted: boolean;
}

export type StartedJob = Omit<ImportJob, "done" | "waiting" | "live" | "running" | "interrupted">;

export type JobAction =
  | { type: "start"; job: StartedJob }
  | { type: "progress"; done: number; total: number }
  | { type: "wait"; waiting: { attempt: number; of: number } | null }
  | { type: "result"; result: RowResult }
  | { type: "finish"; results: RowResult[] }
  | { type: "dismiss" };

/** How a job's state changes. Pure. */
export function jobReducer(state: ImportJob | null, action: JobAction): ImportJob | null {
  switch (action.type) {
    case "start":
      return { ...action.job, done: action.job.offset, waiting: null, live: [], running: true, interrupted: false };
    case "dismiss":
      return null;
  }
  if (!state) return state;
  switch (action.type) {
    case "progress":
      return { ...state, done: action.done + state.offset, waiting: null };
    case "wait":
      return { ...state, waiting: action.waiting };
    case "result":
      return { ...state, live: [...state.live, action.result] };
    case "finish":
      return { ...state, running: false, interrupted: false, waiting: null, done: state.total, results: action.results };
  }
}

/** What an earlier pass of the same class came to, with this pass laid over it, in the order of the sheet. Pure. */
export function mergeResults(before: readonly RowResult[] | null, pass: readonly RowResult[]): RowResult[] {
  return [...(before ?? []).filter((r) => !pass.some((d) => d.line === r.line)), ...pass].sort((a, b) => a.line - b.line);
}

/** The rows of an import that no result covers yet: what is left to do. Pure. */
export const remainingRows = (job: Pick<ImportJob, "rows" | "results">): ImportRow[] => job.rows.filter((r) => !(job.results ?? []).some((x) => x.line === r.line));

// --- Keeping it across a reload (D-161) -------------------------------------------------------------------------------

const STORAGE_KEY = "school.import-job";

/**
 * What is kept in this tab while an import runs, and until its results are closed: the sheet's rows and what each student
 * came to, passwords included, because the sign-in sheet is made from them. It is in the tab's session storage, which is
 * gone when the tab closes; it is removed when the results are closed with Done. Pure.
 */
export function serializeJob(job: ImportJob): string {
  const results = job.running ? mergeResults(job.results, job.live) : job.results;
  return JSON.stringify({ userId: job.userId, classId: job.classId, levelId: job.levelId, className: job.className, rows: job.rows, total: job.total, offset: job.offset, results, running: job.running || job.interrupted });
}

/** The job kept by `serializeJob`, as it stands after a reload: one that was running is stopped and can be continued. Pure. */
export function restoreJob(text: string | null): ImportJob | null {
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as Partial<ImportJob> & { running?: boolean };
    if (typeof saved.userId !== "string" || typeof saved.classId !== "string" || typeof saved.levelId !== "string" || typeof saved.className !== "string" || !Array.isArray(saved.rows) || typeof saved.total !== "number") return null;
    const results = Array.isArray(saved.results) ? saved.results : null;
    return {
      userId: saved.userId,
      classId: saved.classId,
      levelId: saved.levelId,
      className: saved.className,
      rows: saved.rows,
      total: saved.total,
      offset: 0,
      done: (results ?? []).length,
      waiting: null,
      live: [],
      results,
      running: false,
      interrupted: saved.running === true,
    };
  } catch {
    return null;
  }
}

const readStored = (): ImportJob | null => {
  if (typeof window === "undefined") return null;
  try {
    return restoreJob(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

export interface StartArgs {
  classId: string;
  levelId: string;
  className: string;
  /** The rows to send in this pass. */
  rows: ImportRow[];
  confirmDuplicate?: boolean;
  /** What the first pass came to, when this pass is the "admit anyway" one or a continued import. */
  previous?: RowResult[] | null;
  /** Every row of the sheet, when this pass sends only some of them (a continued import). */
  allRows?: ImportRow[];
  /** The last student sent before a reload may have got in: look for them before sending anyone. */
  checkFirst?: boolean;
}

export interface ImportJobValue {
  job: ImportJob | null;
  /** False when another import is still running. */
  start: (args: StartArgs) => boolean;
  /** Sends what an interrupted import had not finished. */
  resume: () => boolean;
  dismiss: () => void;
  /** How many imports have finished, so a page showing the class can read it again. */
  finished: number;
}

const idle: ImportJobValue = { job: null, start: () => false, resume: () => false, dismiss: () => {}, finished: 0 };
export const ImportJobContext = createContext<ImportJobValue>(idle);
export const useImportJob = (): ImportJobValue => useContext(ImportJobContext);

export function ImportJobProvider({ children }: { children: ReactNode }) {
  const { api, me } = useSession();
  const [job, dispatch] = useReducer(jobReducer, null, readStored);
  const [finished, setFinished] = useState(0);
  const running = useRef(false);

  // Kept in this tab as it goes, and removed when the results are closed.
  useEffect(() => {
    try {
      if (job) window.sessionStorage.setItem(STORAGE_KEY, serializeJob(job));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be off (a private window): the import still runs, it just cannot be continued after a reload.
    }
  }, [job]);

  // Closing or reloading the tab stops the import: the browser asks first.
  const isRunning = job?.running === true;
  useEffect(() => {
    if (!isRunning) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [isRunning]);

  const userId = me?.id ?? "";
  const start = useCallback(
    (args: StartArgs) => {
      if (running.current || !userId) return false;
      running.current = true;
      const all = args.allRows ?? args.rows;
      const offset = args.allRows ? (args.previous ?? []).length : 0;
      dispatch({ type: "start", job: { userId, classId: args.classId, levelId: args.levelId, className: args.className, rows: all, total: all.length, offset, results: args.previous ?? null } });
      void (async () => {
        try {
          const [{ admitRows }, { classSids, makeAdmitDeps }, { loginsCsv }] = await Promise.all([import("@/sheets/admit-rows"), import("./import-deps"), import("@/sheets/student-import")]);
          const known = await classSids(api, args.classId);
          const pass = await admitRows(makeAdmitDeps(api, args.classId, args.levelId), args.rows, {
            confirmDuplicate: args.confirmDuplicate,
            known,
            pauseMs: 2500,
            checkFirst: args.checkFirst,
            onProgress: (done) => dispatch({ type: "progress", done, total: all.length }),
            onWait: ({ attempt, of }) => dispatch({ type: "wait", waiting: { attempt, of } }),
            onResult: (result) => dispatch({ type: "result", result }),
          });
          const results = mergeResults(args.previous ?? null, pass);
          dispatch({ type: "finish", results });
          // Once everything is in, the sign-in sheet is saved straight away; the pop-up has a button for it again.
          if (results.some((r) => r.status === "admitted")) saveFile("sign-in-sheet.csv", loginsCsv(results));
        } catch {
          // The code for admitting students could not be loaded (no connection): the import ends with what it had.
          dispatch({ type: "finish", results: args.previous ?? [] });
        } finally {
          running.current = false;
          setFinished((n) => n + 1);
        }
      })();
      return true;
    },
    [api, userId],
  );

  const mine = job && job.userId === userId ? job : null;
  const resume = useCallback(() => {
    if (!mine) return false;
    return start({ classId: mine.classId, levelId: mine.levelId, className: mine.className, rows: remainingRows(mine), previous: mine.results, allRows: mine.rows, checkFirst: true });
  }, [mine, start]);

  const value = useMemo<ImportJobValue>(() => ({ job: mine, start, resume, dismiss: () => dispatch({ type: "dismiss" }), finished }), [mine, start, resume, finished]);
  return <ImportJobContext.Provider value={value}>{children}</ImportJobContext.Provider>;
}
