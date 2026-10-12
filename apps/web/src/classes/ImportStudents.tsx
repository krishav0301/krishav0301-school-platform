"use client";

import { FileDown, FileUp } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { saveFile } from "@/sheets/download";
import { firstProblem, loginsCsv, parseStudentSheet, studentTemplateCsv, type ImportRow, type RowResult } from "@/sheets/student-import";
import { readTable } from "@/sheets/table";
import { Button, Notice } from "@/ui";

import styles from "./classes.module.css";
import { useImportJob, type ImportJob } from "./import-job";

const WHY: Record<"no_name_column" | "no_rows" | "too_many", MessageKey> = {
  no_name_column: "classes.import.noName",
  no_rows: "classes.import.noRows",
  too_many: "classes.import.tooMany",
};

/** A small bar while the students are being added: "20 of 40 students done", filled to that share. It grows by transform only. Pure. */
export function ImportProgressBar({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const label = t("classes.import.progress", { done, total });
  return (
    <div className={styles.progress}>
      <p className={styles.importNote} aria-live="polite">
        {label}
      </p>
      <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className={styles.progressFill} style={{ transform: `scaleX(${share})` }} />
      </div>
    </div>
  );
}

/** How many of each kind, for the line over the results. Pure. */
export function tally(results: readonly RowResult[]): { admitted: number; duplicates: number; problems: number } {
  return { admitted: results.filter((r) => r.status === "admitted").length, duplicates: results.filter((r) => r.status === "duplicate").length, problems: results.filter((r) => r.status === "problem").length };
}

/** While the students are being added: the bar, the wait if the server is busy, and the sheet so far. Pure. */
export function ImportRunning({ job }: { job: ImportJob }) {
  return (
    <div className={styles.importBox}>
      <p className={styles.importNote}>{t("classes.import.background")}</p>
      <ImportProgressBar done={job.done} total={job.total} />
      {job.waiting ? <Notice tone="ok">{t("classes.import.waiting", { attempt: job.waiting.attempt, of: job.waiting.of })}</Notice> : null}
      {job.live.some((r) => r.status === "admitted") ? (
        <div>
          <Button variant="secondary" onClick={() => saveFile("sign-in-sheet.csv", loginsCsv(job.live))}>
            <FileDown aria-hidden width={18} height={18} />
            {t("classes.import.saveSoFar")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What the import came to: how many were admitted, the sign-in sheet, the possible duplicates and the rows left out. Pure apart from its buttons. */
export function ImportResults({ job, results, onAdmitAnyway, onDone }: { job: ImportJob; results: readonly RowResult[]; onAdmitAnyway: () => void; onDone: () => void }) {
  const { config } = useConfig();
  const count = tally(results);
  return (
    <div className={styles.importBox}>
      <Notice tone={count.problems + count.duplicates > 0 ? "bad" : "ok"}>{t("classes.import.result", { admitted: count.admitted, class: job.className })}</Notice>
      {count.admitted > 0 ? (
        <>
          <p className={styles.importNote}>{t(config?.school.studentKeepsPin ? "classes.import.passwordsOnceKeep" : "classes.import.passwordsOnce")}</p>
          <div>
            <Button onClick={() => saveFile("sign-in-sheet.csv", loginsCsv(results))}>
              <FileDown aria-hidden width={18} height={18} />
              {t("classes.import.downloadLogins")}
            </Button>
          </div>
        </>
      ) : null}
      {count.duplicates > 0 ? (
        <>
          <p className={styles.importNote}>{t("classes.import.duplicates", { count: count.duplicates })}</p>
          <ul className={styles.importList}>
            {results
              .filter((r): r is Extract<RowResult, { status: "duplicate" }> => r.status === "duplicate")
              .map((r) => (
                <li key={r.line}>{t("classes.import.duplicateRow", { line: r.line, name: r.name, who: r.matches.map((m) => `${m.name} (${m.sid})`).join(", ") })}</li>
              ))}
          </ul>
          <div>
            <Button variant="secondary" onClick={onAdmitAnyway}>
              {t("classes.import.admitAnyway", { count: count.duplicates })}
            </Button>
          </div>
        </>
      ) : null}
      {count.problems > 0 ? (
        <>
          <p className={styles.importNote}>{t("classes.import.problems", { count: count.problems })}</p>
          <ul className={styles.importList}>
            {results
              .filter((r): r is Extract<RowResult, { status: "problem" }> => r.status === "problem")
              .map((r) => (
                <li key={r.line}>{t("classes.import.problemRow", { line: r.line, name: r.name || "—", message: r.message })}</li>
              ))}
          </ul>
        </>
      ) : null}
      <div>
        <Button variant="secondary" onClick={onDone}>
          {t("classes.import.dismiss")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A class list from Excel (the PM, 2026-10-11): download the template, fill it, choose the file, look at what it found,
 * and admit. Each row is admitted as the quick form admits one, to this class; a row with a problem is left out and said
 * so; a possible duplicate waits for a deliberate "admit anyway". The logins are given once, as a sheet to hand out.
 * The import itself lives beside the page (D-155): closing this window does not stop it, and the top bar brings it back.
 */
export function ImportStudents({ classId, levelId, className }: { classId: string; levelId: string; className: string }) {
  const { job, start, dismiss } = useImportJob();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [failure, setFailure] = useState<MessageKey | null>(null);

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFailure(null);
    const read = await readTable(file);
    if (!read.ok) return setFailure(read.reason === "unsupported" ? "classes.import.unsupported" : "classes.import.unreadable");
    const parsed = parseStudentSheet(read.rows, levelId);
    if (!parsed.ok) {
      setRows(null);
      return setFailure(WHY[parsed.reason]);
    }
    setRows(parsed.rows);
    setIgnored(parsed.ignored);
  }

  // This class's import, running or done: shown in place of the file chooser until the person says Done.
  const mine = job && job.classId === classId ? job : null;
  if (mine?.running) return <ImportRunning job={mine} />;
  if (mine?.results) {
    const waiting = mine.rows.filter((r) => mine.results!.some((x) => x.line === r.line && x.status === "duplicate"));
    return <ImportResults job={mine} results={mine.results} onAdmitAnyway={() => void start({ classId, levelId, className, rows: waiting, confirmDuplicate: true, previous: mine.results })} onDone={dismiss} />;
  }

  const other = job && !mine ? job : null;
  const ready = rows?.filter((r) => firstProblem(r) === null) ?? [];
  const found = rows ? rows.length : 0;

  return (
    <div className={styles.importBox}>
      <p className={styles.importNote}>{t("classes.import.intro", { class: className })}</p>
      {other ? <Notice tone="bad">{t("classes.import.otherRunning", { class: other.className })}</Notice> : null}
      <div className={styles.importActions}>
        <Button variant="secondary" onClick={() => saveFile("students-template.csv", studentTemplateCsv())}>
          <FileDown aria-hidden width={18} height={18} />
          {t("classes.import.template")}
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          <FileUp aria-hidden width={18} height={18} />
          {t("classes.import.choose")}
        </Button>
        <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void chosen(e)} aria-label={t("classes.import.choose")} />
      </div>
      {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}
      {rows ? (
        <>
          <p className={styles.importNote}>{t("classes.import.found", { found, ready: ready.length })}</p>
          {ignored.length > 0 ? <p className={styles.importNote}>{t("classes.import.ignored", { names: ignored.join(", ") })}</p> : null}
          <div className={styles.importTable} role="region" aria-label={t("classes.import.preview")} tabIndex={0}>
            <table>
              <caption className="sr-only">{t("classes.import.preview")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("classes.import.row")}</th>
                  <th scope="col">{t("classes.import.name")}</th>
                  <th scope="col">{t("classes.import.check")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const problem = firstProblem(r);
                  return (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>{[r.values.firstName, r.values.middleName, r.values.lastName].filter(Boolean).join(" ") || "—"}</td>
                      <td className={problem ? styles.importBad : undefined}>{problem ? t(problem) : t("classes.import.ready")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <Button disabled={ready.length === 0 || other?.running === true} onClick={() => void start({ classId, levelId, className, rows })}>
              {t("classes.import.admit", { count: ready.length })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
