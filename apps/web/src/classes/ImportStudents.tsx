"use client";

import { FileDown, FileUp } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { registerWalkIn, suggestStudentEmail } from "@/admissions/client";
import { useConfig } from "@/config/ConfigProvider";
import { toAd } from "@/content/client";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { admitRows, type AdmitDeps } from "@/sheets/admit-rows";
import { firstProblem, loginsCsv, parseStudentSheet, studentTemplateCsv, type ImportRow, type RowResult } from "@/sheets/student-import";
import { readTable } from "@/sheets/table";
import { Button, Notice } from "@/ui";

import styles from "./classes.module.css";

const WHY: Record<"no_name_column" | "no_rows" | "too_many", MessageKey> = {
  no_name_column: "classes.import.noName",
  no_rows: "classes.import.noRows",
  too_many: "classes.import.tooMany",
};

function save(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** How many of each kind, for the line over the results. Pure. */
export function tally(results: readonly RowResult[]): { admitted: number; duplicates: number; problems: number } {
  return { admitted: results.filter((r) => r.status === "admitted").length, duplicates: results.filter((r) => r.status === "duplicate").length, problems: results.filter((r) => r.status === "problem").length };
}

/**
 * A class list from Excel (the PM, 2026-10-11): download the template, fill it, choose the file, look at what it found,
 * and admit. Each row is admitted as the quick form admits one, to this class; a row with a problem is left out and said
 * so; a possible duplicate waits for a deliberate "admit anyway". The logins are given once, as a sheet to hand out.
 */
export function ImportStudents({ classId, levelId, className, onDone }: { classId: string; levelId: string; className: string; onDone: () => void }) {
  const { api } = useSession();
  const { config } = useConfig();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);

  const deps = useMemo<AdmitDeps>(
    () => ({
      toAd: (bs) => toAd(api, bs),
      suggestEmail: (firstName) => suggestStudentEmail(api, firstName),
      walkIn: (values, ad, confirm) => registerWalkIn(api, values, ad, classId, confirm),
    }),
    [api, classId],
  );

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFailure(null);
    setResults(null);
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

  async function run(which: readonly ImportRow[], confirmDuplicate: boolean) {
    setProgress({ done: 0, total: which.length });
    const done = await admitRows(deps, which, { confirmDuplicate, onProgress: (d, total) => setProgress({ done: d, total }) });
    setProgress(null);
    // What was admitted before stays; the rows just tried are replaced by what they came to.
    setResults((before) => [...(before ?? []).filter((r) => !done.some((d) => d.line === r.line)), ...done].sort((a, b) => a.line - b.line));
    onDone();
  }

  const ready = rows?.filter((r) => firstProblem(r) === null) ?? [];
  const found = rows ? rows.length : 0;

  if (results) {
    const count = tally(results);
    const waiting = rows?.filter((r) => results.some((x) => x.line === r.line && x.status === "duplicate")) ?? [];
    return (
      <div className={styles.importBox}>
        <Notice tone={count.problems + count.duplicates > 0 ? "bad" : "ok"}>{t("classes.import.result", { admitted: count.admitted, class: className })}</Notice>
        {count.admitted > 0 ? (
          <>
            <p className={styles.importNote}>{t(config?.school.studentKeepsPin ? "classes.import.passwordsOnceKeep" : "classes.import.passwordsOnce")}</p>
            <div>
              <Button onClick={() => save("sign-in-sheet.csv", loginsCsv(results))}>
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
              <Button variant="secondary" loading={progress !== null} loadingLabel={t("classes.import.running", { done: progress?.done ?? 0, total: progress?.total ?? 0 })} onClick={() => void run(waiting, true)}>
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
      </div>
    );
  }

  return (
    <div className={styles.importBox}>
      <p className={styles.importNote}>{t("classes.import.intro", { class: className })}</p>
      <div className={styles.importActions}>
        <Button variant="secondary" onClick={() => save("students-template.csv", studentTemplateCsv())}>
          <FileDown aria-hidden width={18} height={18} />
          {t("classes.import.template")}
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={progress !== null}>
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
            <Button disabled={ready.length === 0 || progress !== null} loading={progress !== null} loadingLabel={t("classes.import.running", { done: progress?.done ?? 0, total: progress?.total ?? 0 })} onClick={() => void run(rows, false)}>
              {t("classes.import.admit", { count: ready.length })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
