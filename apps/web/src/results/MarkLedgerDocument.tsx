"use client";

import { Printer } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button } from "@/ui";

import { gateFailure, loadLedger } from "./client";
import styles from "./documents.module.css";
import { hundredthsText, type MarkLedger } from "./model";

/** What heads a subject's column: the short name the school set (Eng, Nep, Sci), else the subject's name. Pure. */
export const columnName = (s: MarkLedger["subjects"][number]): string => s.code ?? s.name;

/** A mark as the ledger prints it: to two places, "AB" for an absence, nothing for a subject the student does not take. Pure. */
export const markCell = (m: MarkLedger["students"][number]["marks"][number]): string => (m === null ? "" : m.absent ? t("results.doc.absent") : hundredthsText(m.valueHundredths));

/**
 * The class's mark ledger as the school prints it (the PM, 2026-10-28): every student's marks in every subject, the total,
 * the percentage and the rank in the class, with the three signatures empty for the people who prepare, check and approve
 * it. Pure.
 */
export function MarkLedgerDocument({ ledger }: { ledger: MarkLedger }) {
  return (
    <article className={`${styles.sheet} ${styles.ledger}`} aria-labelledby="ledger-heading">
      <header className={styles.head}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a pre-sized crest in a static export */}
        {ledger.school.crest ? <img className={styles.crest} src={`/site/${ledger.school.crest}`} alt={t("results.doc.crestAlt")} width={64} height={64} /> : null}
        <p className={styles.schoolName}>{ledger.school.name}</p>
        <p className={styles.line}>{ledger.school.address}</p>
        {ledger.school.contact ? <p className={styles.line}>{ledger.school.contact}</p> : null}
        <h1 id="ledger-heading" className={styles.docTitle}>
          {t("results.doc.ledger")}
        </h1>
      </header>
      <div className={styles.meta}>
        <dl>
          <dt>{t("results.doc.acadYear")}</dt>
          <dd>{ledger.yearLabel}</dd>
          <dt>{t("results.doc.class")}</dt>
          <dd>{ledger.className}</dd>
        </dl>
        <dl>
          <dt>{t("results.doc.exam.label")}</dt>
          <dd>{ledger.examName ?? t("results.doc.finalExamName")}</dd>
        </dl>
      </div>
      <div className={styles.scroll}>
        <table className={`${styles.grid} ${styles.ledgerGrid}`}>
          <thead>
            <tr>
              <th>{t("results.doc.rollCol")}</th>
              <th className={styles.left}>{t("results.doc.studentCol")}</th>
              {ledger.subjects.map((s) => (
                <th key={s.offeringId} title={s.name}>
                  {columnName(s)}
                </th>
              ))}
              <th>{t("results.doc.totalCol")}</th>
              <th>{t("results.doc.perCol")}</th>
              <th>{t("results.doc.rankCol")}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.students.map((s) => (
              <tr key={s.enrollmentId}>
                <td>{s.rollNo ?? ""}</td>
                <td className={styles.left}>{s.name}</td>
                {s.marks.map((m, i) => (
                  <td key={ledger.subjects[i]!.offeringId}>{markCell(m)}</td>
                ))}
                <td>{hundredthsText(s.totalHundredths)}</td>
                <td>{hundredthsText(s.percentHundredths)}</td>
                <td>{s.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.signatures}>
        <span className={styles.signature}>{t("results.doc.preparedBy")}</span>
        <span className={styles.signature}>{t("results.doc.checkedBy")}</span>
        <span className={styles.signature}>{t("results.doc.approvedBy")}</span>
      </div>
    </article>
  );
}

/** A class's mark ledger (`?class=&exam=`), `exam` the terminal's id or `final`. Printable. */
export function MarkLedgerScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const { classId, exam } = useMemo(() => {
    const q = new URLSearchParams(search ?? "");
    return { classId: q.get("class") ?? "", exam: q.get("exam") ?? "" };
  }, [search]);
  const loadNow = useCallback(async () => {
    if (!classId || !exam) return gateFailure("failed");
    const result = await loadLedger(api, classId, exam === "final" ? null : exam);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId, exam]);
  const { view, reload } = useLoad<MarkLedger>(loadNow);
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(ledger) => (
        <>
          <MarkLedgerDocument ledger={ledger} />
          <div className={`${styles.actions} ${styles.noPrint}`}>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden width={18} height={18} />
              {t("results.doc.print")}
            </Button>
          </div>
        </>
      )}
    </Gate>
  );
}
