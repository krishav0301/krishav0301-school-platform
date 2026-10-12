"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import { useSession } from "@/session/SessionProvider";
import { saveFile } from "@/sheets/download";
import type { ImportRow, RowResult } from "@/sheets/student-import";

/**
 * The class import as something that lives beside the page (the PM, 2026-10-12, D-155): it keeps running when its pop-up is
 * closed or the person goes to another page of the portal, shows in the top bar with its progress, and opens again where it
 * was. One at a time. A reload or closing the tab still stops it, and the browser asks first.
 *
 * This file is in every page of the site (the provider sits at the root), so it imports nothing heavy: the code that admits
 * students is loaded only when an import starts, which keeps the public pages inside their page-weight budget.
 */
export interface ImportJob {
  classId: string;
  levelId: string;
  className: string;
  /** The rows being added in this run, kept so a possible duplicate can be admitted on purpose afterwards. */
  rows: ImportRow[];
  total: number;
  done: number;
  waiting: { attempt: number; of: number } | null;
  /** Each student's result as it comes, so the sign-in sheet can be saved before the end. */
  live: RowResult[];
  /** Everything the class import has come to (earlier passes included); null while the first pass runs. */
  results: RowResult[] | null;
  running: boolean;
}

export type JobAction =
  | { type: "start"; job: Omit<ImportJob, "done" | "waiting" | "live" | "results" | "running"> & { results: RowResult[] | null } }
  | { type: "progress"; done: number; total: number }
  | { type: "wait"; waiting: { attempt: number; of: number } | null }
  | { type: "result"; result: RowResult }
  | { type: "finish"; results: RowResult[] }
  | { type: "dismiss" };

/** How a job's state changes. Pure. */
export function jobReducer(state: ImportJob | null, action: JobAction): ImportJob | null {
  switch (action.type) {
    case "start":
      return { ...action.job, done: 0, waiting: null, live: [], running: true };
    case "dismiss":
      return null;
  }
  if (!state) return state;
  switch (action.type) {
    case "progress":
      return { ...state, done: action.done, total: action.total, waiting: null };
    case "wait":
      return { ...state, waiting: action.waiting };
    case "result":
      return { ...state, live: [...state.live, action.result] };
    case "finish":
      return { ...state, running: false, waiting: null, done: state.total, results: action.results };
  }
}

/** What an earlier pass of the same class came to, with this pass laid over it, in the order of the sheet. Pure. */
export function mergeResults(before: readonly RowResult[] | null, pass: readonly RowResult[]): RowResult[] {
  return [...(before ?? []).filter((r) => !pass.some((d) => d.line === r.line)), ...pass].sort((a, b) => a.line - b.line);
}

export interface StartArgs {
  classId: string;
  levelId: string;
  className: string;
  rows: ImportRow[];
  confirmDuplicate?: boolean;
  /** What the first pass came to, when this pass is the "admit anyway" one. */
  previous?: RowResult[] | null;
}

export interface ImportJobValue {
  job: ImportJob | null;
  /** False when another import is still running. */
  start: (args: StartArgs) => boolean;
  dismiss: () => void;
  /** How many imports have finished, so a page showing the class can read it again. */
  finished: number;
}

const idle: ImportJobValue = { job: null, start: () => false, dismiss: () => {}, finished: 0 };
export const ImportJobContext = createContext<ImportJobValue>(idle);
export const useImportJob = (): ImportJobValue => useContext(ImportJobContext);

export function ImportJobProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [job, dispatch] = useReducer(jobReducer, null);
  const [finished, setFinished] = useState(0);
  const running = useRef(false);

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

  const start = useCallback(
    (args: StartArgs) => {
      if (running.current) return false;
      running.current = true;
      dispatch({ type: "start", job: { classId: args.classId, levelId: args.levelId, className: args.className, rows: args.rows, total: args.rows.length, results: args.previous ?? null } });
      void (async () => {
        try {
          const [{ admitRows }, { classSids, makeAdmitDeps }, { loginsCsv }] = await Promise.all([import("@/sheets/admit-rows"), import("./import-deps"), import("@/sheets/student-import")]);
          const known = await classSids(api, args.classId);
          const pass = await admitRows(makeAdmitDeps(api, args.classId, args.levelId), args.rows, {
            confirmDuplicate: args.confirmDuplicate,
            known,
            pauseMs: 600,
            onProgress: (done, total) => dispatch({ type: "progress", done, total }),
            onWait: ({ attempt, of }) => dispatch({ type: "wait", waiting: { attempt, of } }),
            onResult: (result) => dispatch({ type: "result", result }),
          });
          const results = mergeResults(args.previous ?? null, pass);
          dispatch({ type: "finish", results });
          // Once everything is in, the sign-in sheet is saved straight away; the pop-up has a button for it again.
          if (pass.some((r) => r.status === "admitted")) saveFile("sign-in-sheet.csv", loginsCsv(results));
        } catch {
          // The code for admitting students could not be loaded (no connection): the import ends with nothing added.
          dispatch({ type: "finish", results: args.previous ?? [] });
        } finally {
          running.current = false;
          setFinished((n) => n + 1);
        }
      })();
      return true;
    },
    [api],
  );

  const value = useMemo<ImportJobValue>(
    () => ({
      job,
      start,
      dismiss: () => dispatch({ type: "dismiss" }),
      finished,
    }),
    [job, start, finished],
  );
  return <ImportJobContext.Provider value={value}>{children}</ImportJobContext.Provider>;
}
