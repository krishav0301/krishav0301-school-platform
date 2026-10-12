"use client";

import { FileDown, FileUp } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { approveApplication, browseStudents, issueStudentPin, loadApplication, loadQueue, registerWalkIn, suggestStudentEmail } from "@/admissions/client";
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
  // What has been admitted so far in this run, and whether the server is being waited for: the sign-in sheet can be saved at any point.
  const [live, setLive] = useState<RowResult[]>([]);
  const [waiting, setWaiting] = useState<{ attempt: number; of: number } | null>(null);

  const deps = useMemo<AdmitDeps>(
    () => ({
      toAd: (bs) => toAd(api, bs),
      suggestEmail: (firstName, lastName) => suggestStudentEmail(api, firstName, lastName),
      walkIn: (values, ad, confirm) => registerWalkIn(api, values, ad, classId, confirm),
      recovery: {
        // What a try that got no answer may have left: the application waiting in the queue (found by name and its own sign-in email)...
        pendingApplications: async (values) => {
          const queue = await loadQueue(api);
          if (!queue.ok) return null;
          const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
          const named = queue.data.filter((a) => a.status === "pending_review" && a.walkIn && a.levelId === levelId && same(a.firstName, values.firstName) && same(a.lastName, values.lastName));
          const ids: string[] = [];
          for (const a of named) {
            const detail = await loadApplication(api, a.id);
            if (detail.ok && same(detail.data.email, values.email)) ids.push(a.id);
          }
          return ids;
        },
        approve: (id) => approveApplication(api, id, classId, null),
        // ...or the student it admitted before the answer was lost.
        studentsNamed: async (values) => {
          const found = await browseStudents(api, { class: classId, status: "all", q: [values.firstName, values.lastName].filter(Boolean).join(" "), pageSize: 50 });
          if (!found.ok) return null;
          const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
          return found.data.students.filter((x) => same(x.firstName, values.firstName) && same(x.lastName, values.lastName)).map((x) => ({ id: x.id, sid: x.sid }));
        },
        newPassword: async (studentId) => {
          const pin = await issueStudentPin(api, studentId);
          return pin.ok ? pin.password : null;
        },
      },
    }),
    [api, classId, levelId],
  );

  // The students already in the class, so the run never mistakes one of them for a student it admitted itself.
  async function classSids(): Promise<Set<string>> {
    const sids = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const found = await browseStudents(api, { class: classId, status: "all", pageSize: 50, page });
      if (!found.ok) break;
      found.data.students.forEach((x) => sids.add(x.sid));
      if (found.data.students.length < 50) break;
    }
    return sids;
  }

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
    setLive([]);
    setWaiting(null);
    const known = await classSids();
    const done = await admitRows(deps, which, {
      confirmDuplicate,
      known,
      pauseMs: 600,
      onProgress: (d, total) => {
        setProgress({ done: d, total });
        setWaiting(null);
      },
      onWait: ({ attempt, of }) => setWaiting({ attempt, of }),
      onResult: (r) => setLive((before) => [...before, r]),
    });
    setProgress(null);
    setWaiting(null);
    // Once everything is in, the sign-in sheet is saved straight away; the button below saves it again.
    if (done.some((r) => r.status === "admitted")) save("sign-in-sheet.csv", loginsCsv(done));
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
            {progress !== null && waiting ? <Notice tone="ok">{t("classes.import.waiting", { attempt: waiting.attempt, of: waiting.of })}</Notice> : null}
            {progress !== null && live.some((r) => r.status === "admitted") ? (
              <Button variant="secondary" onClick={() => save("sign-in-sheet.csv", loginsCsv(live))}>
                <FileDown aria-hidden width={18} height={18} />
                {t("classes.import.saveSoFar")}
              </Button>
            ) : null}
            <Button disabled={ready.length === 0 || progress !== null} loading={progress !== null} loadingLabel={t("classes.import.running", { done: progress?.done ?? 0, total: progress?.total ?? 0 })} onClick={() => void run(rows, false)}>
              {t("classes.import.admit", { count: ready.length })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
