"use client";

import { Download, Printer } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Notice } from "@/ui";

import { gateFailure, loadGradeSheet, notForYou } from "./client";
import styles from "./documents.module.css";
import { downloadAsPdf, fileSafe } from "./download-pdf";
import { formatMarks, hundredthsText, pointTableText, pointText, tenthsText, type GradeSheet } from "./model";

type Part = NonNullable<GradeSheet["subjects"][number]["theory"]>;

/** A part of a paper as the card prints it: the mark to two places, "AB" for an absence, empty when the paper has no such part. Pure. */
export const partCell = (part: Part | null): string => (part === null ? "" : part.absent ? t("results.doc.absent") : part.valueHundredths === null ? "" : hundredthsText(part.valueHundredths));

/** One band's range as the grade table prints it: "90 to 100", "80 to below 90", "Below 35". Pure. */
export function rangeText(band: GradeSheet["scale"][number]): string {
  if (band.upTo === null) return t("results.doc.range", { from: band.from, to: 100 });
  if (band.from === 0) return t("results.doc.below", { to: band.upTo });
  return t("results.doc.rangeBelow", { from: band.from, to: band.upTo });
}

const OTHER_ACTIVITY_ROWS = 8;
/** A card with this many subjects or more is drawn closer, so it still fits one sheet. */
export const DENSE_FROM = 13;

/**
 * The marks card as the school prints it, a GRADE-SHEET of grade points (the PM, 2026-10-28). The school's name, grade table,
 * and every figure come from the server, worked out from the stored card; attendance, exam remarks, other activities and
 * the three signatures are left empty for the teacher to fill in by hand on the printed copy. Pure.
 */
export function GradeSheetDocument({ sheet }: { sheet: GradeSheet }) {
  const exam = sheet.examName === null ? t("results.doc.finalExam", { year: sheet.yearLabel }) : t("results.doc.exam", { exam: sheet.examName, year: sheet.yearLabel });
  return (
    <article className={[styles.sheet, sheet.paper === "accent" ? styles.paper : "", sheet.subjects.length >= DENSE_FROM ? styles.dense : ""].filter(Boolean).join(" ")} aria-labelledby="gradesheet-heading">
      <header className={styles.head}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a pre-sized crest in a static export */}
        {sheet.school.crest ? <img className={styles.crest} src={`/site/${sheet.school.crest}`} alt={t("results.doc.crestAlt")} width={64} height={64} /> : null}
        <p className={styles.schoolName}>{sheet.school.name}</p>
        <p className={styles.line}>{sheet.school.address}</p>
        <h1 id="gradesheet-heading" className={styles.docTitle}>
          {t("results.doc.gradeSheet")}
        </h1>
      </header>
      <p className={styles.examBox}>{exam}</p>
      <div className={styles.who}>
        <dl>
          <dt>{t("results.doc.studentName")}</dt>
          <dd>{sheet.student.name}</dd>
          <dt>{t("results.doc.class")}</dt>
          <dd>{sheet.className}</dd>
          <dt>{t("results.doc.dateOfBirth")}</dt>
          <dd>{sheet.student.dateOfBirthBs ?? ""}</dd>
        </dl>
        <dl>
          <dt>{t("results.doc.regNo")}</dt>
          <dd>{sheet.student.sid}</dd>
          <dt>{t("results.doc.rollNo")}</dt>
          <dd>{sheet.student.rollNo ?? ""}</dd>
        </dl>
      </div>
      <div className={`${styles.scroll} ${styles.grow}`}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th rowSpan={2}>{t("results.doc.sn")}</th>
              <th rowSpan={2}>{t("results.doc.subject")}</th>
              <th rowSpan={2}>{t("results.doc.fullMark")}</th>
              <th colSpan={2}>{t("results.doc.obtMarks")}</th>
              <th colSpan={2}>{t("results.doc.obtGrade")}</th>
              <th rowSpan={2}>{t("results.doc.finalGrade")}</th>
              <th rowSpan={2}>{t("results.doc.gradePoint")}</th>
              <th rowSpan={2}>{t("results.doc.highestGp")}</th>
            </tr>
            <tr>
              <th>{t("results.doc.th")}</th>
              <th>{t("results.doc.pr")}</th>
              <th>{t("results.doc.th")}</th>
              <th>{t("results.doc.pr")}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.subjects.map((s, i) => (
              <tr key={s.offeringId}>
                <td>{i + 1}</td>
                <td className={styles.left}>{s.name}</td>
                <td>{formatMarks(s.fullHundredths)}</td>
                <td>{s.theory === null ? hundredthsText(s.obtainedHundredths) : partCell(s.theory)}</td>
                <td>{partCell(s.practical)}</td>
                <td>{s.theoryGrade ?? ""}</td>
                <td>{s.practicalGrade ?? ""}</td>
                <td>{s.finalGrade}</td>
                <td>{pointText(s.pointHundredths)}</td>
                <td>{pointText(s.highestPointHundredths)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.total}>
              <td colSpan={2} className={styles.left}>
                {t("results.doc.total")}
              </td>
              <td>{hundredthsText(sheet.totalFullHundredths)}</td>
              <td colSpan={2}>{hundredthsText(sheet.totalObtainedHundredths)}</td>
              <td colSpan={2} />
              <td />
              <td>{tenthsText(sheet.averagePointTenths)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th>{t("results.doc.issueDate")}</th>
              <th>{t("results.doc.attendance")}</th>
              <th>{t("results.doc.percentage")}</th>
              <th>{t("results.doc.division")}</th>
              <th colSpan={2}>{t("results.doc.averageGrade")}</th>
              <th>{t("results.doc.rank")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{sheet.issuedOnBs ?? ""}</td>
              <td className={styles.blank} />
              <td>{hundredthsText(sheet.percentHundredths)}</td>
              <td>{sheet.division ?? ""}</td>
              <td>{sheet.overallGrade}</td>
              <td>{tenthsText(sheet.averagePointTenths)}</td>
              <td>
                {sheet.rank}/{sheet.classSize}
              </td>
            </tr>
            <tr>
              <th>{t("results.doc.remarks")}</th>
              <td colSpan={6} className={styles.remarks} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className={styles.pair}>
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <caption>{t("results.doc.details")}</caption>
            <thead>
              <tr>
                <th>{t("results.doc.percentageCol")}</th>
                <th>{t("results.doc.grade")}</th>
                <th>{t("results.doc.point")}</th>
                <th>{t("results.doc.remark")}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.scale.map((b) => (
                <tr key={b.grade}>
                  <td className={styles.range}>{rangeText(b)}</td>
                  <td>{b.grade}</td>
                  <td>{pointTableText(b.pointHundredths)}</td>
                  <td>{b.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <caption>{t("results.doc.otherActivities")}</caption>
            <thead>
              <tr>
                <th>{t("results.doc.topic")}</th>
                <th>{t("results.doc.grade")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: sheet.subjects.length >= DENSE_FROM ? 4 : OTHER_ACTIVITY_ROWS }, (_, i) => (
                <tr key={i}>
                  <td className={styles.remarks} />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={styles.signatures}>
        <span className={styles.signature}>{t("results.doc.guardian")}</span>
        <span className={styles.signature}>{t("results.doc.classTeacher")}</span>
        <span className={styles.signature}>{t("results.doc.principal")}</span>
      </div>
    </article>
  );
}

/** A marks card (`?id=`) as the grade-point GRADE-SHEET, printable. A student finds their own; staff by id. */
export function GradeSheetScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = useMemo(() => new URLSearchParams(search ?? "").get("id") ?? "", [search]);
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadGradeSheet(api, id);
    return result.ok ? result : notForYou(result.reason);
  }, [api, id]);
  const { view, reload } = useLoad<GradeSheet>(loadNow);
  const page = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function download(sheet: GradeSheet) {
    if (!page.current) return;
    setBusy(true);
    setFailed(false);
    try {
      await downloadAsPdf(page.current, fileSafe(sheet.student.name, sheet.student.sid, sheet.examName ?? "final", sheet.yearLabel), styles.capture);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(sheet) => (
        <>
          <div ref={page}>
            <GradeSheetDocument sheet={sheet} />
          </div>
          {failed ? <Notice tone="bad">{t("results.doc.downloadFailed")}</Notice> : null}
          <div className={`${styles.actions} ${styles.noPrint}`}>
            <Button variant="secondary" loading={busy} loadingLabel={t("results.doc.downloading")} onClick={() => void download(sheet)}>
              <Download aria-hidden width={18} height={18} />
              {t("results.doc.download")}
            </Button>
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
