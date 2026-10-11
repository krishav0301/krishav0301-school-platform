"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AccountView } from "@/fees/AccountView";
import { loadStudentAccount } from "@/fees/client";
import type { Account } from "@/fees/model";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { gateFailure, loadStudentResults } from "@/results/client";
import { percentText, type OwnResults } from "@/results/model";
import { resultName } from "@/results/OwnResultsScreen";
import { useLoad } from "@/setup/useLoad";
import { Notice } from "@/ui";

import styles from "./admissions.module.css";
import { loadStudent } from "./client";
import { CorrectDetails } from "./CorrectDetails";
import type { StudentDetail } from "./model";

/**
 * One student's personal record, read only, opened from the Students page (admin FUT F-09). The server decides who may
 * see it and how far (`students.personal.view`, within the person's sections); nothing here can change it.
 */
/** "Information Science and Engineering, 4th Semester – Evening": the course, then the class. Pure. */
export function placeLine(place: NonNullable<StudentDetail["place"]>): string {
  const cls = place.section ? t("students.classIs", { level: place.level, section: place.section }) : place.level;
  return t("admissions.record.placeLine", { course: place.course, class: cls });
}

export function StudentDetails({ student, feesLink = false, actions }: { student: StudentDetail; feesLink?: boolean; actions?: React.ReactNode }) {
  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const given = (value: string | null | undefined) => (value && value.trim() ? value : t("admissions.notGiven"));
  const rows: [string, string][] = [
    [t("admissions.record.sid"), student.sid],
    // Where the student is, each part on its own line (PM, 2026-10-06): wing, course, level, the class's section, term.
    ...(student.place
      ? ([
          [t("admissions.record.wing"), student.place.wing],
          [t("admissions.record.course"), student.place.course],
          [t("admissions.record.level"), student.place.level],
          [t("admissions.record.section"), student.place.section || "—"],
          [t("admissions.record.term"), student.place.term],
        ] as [string, string][])
      : ([[t("admissions.record.class"), t("admissions.record.noClass")]] as [string, string][])),
    [t("admissions.field.dob"), student.dobBs ? formatBsDate(student.dobBs) : given(student.dob)],
    [t("admissions.field.phone"), given(student.phone)],
    [t("admissions.field.email"), given(student.email)],
    [t("admissions.field.guardianName"), given(student.guardianName)],
    [t("admissions.field.guardianPhone"), given(student.guardianPhone)],
    [t("admissions.field.previousSchool"), given(student.previousSchool)],
  ];
  return (
    <>
      <ReadHeader
        title={name}
        subtitle={[student.sid, student.place ? placeLine(student.place) : null].filter(Boolean).join(" · ")}
        crumbs={[{ label: t("admissions.search.title"), href: "/portal/admissions/search" }, { label: name }]}
        actions={
          <>
            {student.status === "active" ? (
              <StatusWord tone="ok">{t("admissions.student.active")}</StatusWord>
            ) : (
              <StatusWord>{t(student.status === "left" ? "admissions.student.left" : "admissions.student.graduated")}</StatusWord>
            )}
            {actions}
          </>
        }
      />
      <Panel title={t("admissions.record.facts")} labelledBy="student-facts" actions={feesLink ? <OpenLink href={`/portal/fees/student?id=${student.id}`} label={t("admissions.record.feesOf", { name })} text={t("admissions.record.fees")} /> : undefined}>
        <dl className={styles.detailGrid}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className={styles.detailLabel}>{label}</dt>
              <dd className={styles.detailValue}>{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}

export function StudentScreen() {
  const { api, me } = useSession();
  const { term, moduleEnabled } = useConfig();
  const search = useAddressQuery();
  const id = search === null ? null : new URLSearchParams(search).get("id");
  const load = useCallback(() => loadStudent(api, id ?? ""), [api, id]);
  const { view, reload } = useLoad(load);
  const [corrected, setCorrected] = useState<StudentDetail | null>(null);
  const [saved, setSaved] = useState(false);
  const roles = me?.roles.map((r) => r.role) ?? [];
  // The Co-ordinator (and Support) may correct details (students.personal.correct); the server checks the section again.
  const canCorrect = roles.some((r) => r === "coordinator" || r === "super_admin");
  // Only roles the matrix lets read fees get the quiet link to the account (D-104); the server checks again there.
  const feesLink = moduleEnabled("fees") && roles.some((r) => r === "admin" || r === "accountant" || r === "super_admin");
  const reader = !roles.some((r) => r === "coordinator" || r === "super_admin");
  // Staff who read results (the Principal, the Co-ordinator, Support) see the student's published results on the record (the PM, 2026-10-11).
  const resultsLink = roles.some((r) => r === "admin" || r === "coordinator" || r === "super_admin");
  if (id === null && search !== null) return <Notice tone="bad">{t("admissions.student.missing")}</Notice>;
  if (view.status === "loading") return <TableSkeleton rows={6} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return (
    <div className={readStyles.page}>
      {saved ? <Notice tone="ok">{t("admissions.correct.done")}</Notice> : null}
      <StudentDetails
        student={corrected ?? view.data}
        feesLink={feesLink}
        actions={
          canCorrect ? (
            <CorrectDetails
              student={corrected ?? view.data}
              onCorrected={(next) => {
                setCorrected(next);
                setSaved(true);
              }}
            />
          ) : null
        }
      />
      {resultsLink && id ? <RecordResults studentId={id} /> : null}
      {feesLink && id ? <RecordFees studentId={id} name={[(corrected ?? view.data).firstName, (corrected ?? view.data).lastName].join(" ")} /> : null}
      {reader ? <ReadOnlyNote>{t("admissions.record.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote> : null}
    </div>
  );
}

/**
 * The student's fees under their record (PM, 2026-10-06), for the roles that may read fees (never the Co-ordinator,
 * CLAUDE.md section 6): the account of their current term, read only; payments and discounts stay on the fee page.
 */
function RecordFees({ studentId, name }: { studentId: string; name: string }) {
  const { api } = useSession();
  // No account yet (no enrollment) is a state of its own, not a failure.
  const load = useCallback(async () => {
    const result = await loadStudentAccount(api, studentId);
    if (result.ok) return result;
    return result.reason === "not_found" ? { ok: true as const, data: null } : { ok: false as const, reason: result.reason };
  }, [api, studentId]);
  const { view, reload } = useLoad<Account | null>(load);
  if (view.status === "loading") return <TableSkeleton rows={3} tiles={4} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <RecordFeesView account={view.data} studentId={studentId} name={name} />;
}

/** The student's published results on their record: each exam, then the final, with the marks card to open. */
function RecordResults({ studentId }: { studentId: string }) {
  const { api } = useSession();
  const load = useCallback(async () => {
    const result = await loadStudentResults(api, studentId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, studentId]);
  const { view, reload } = useLoad<OwnResults>(load);
  if (view.status === "loading") return <TableSkeleton rows={3} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <RecordResultsView results={view.data} />;
}

/** Pure: the results section of a record, or the line that says none is published yet. */
export function RecordResultsView({ results }: { results: OwnResults }) {
  return (
    <section className={readStyles.page} aria-labelledby="record-results">
      <h2 id="record-results" className={readStyles.panelTitle}>
        {t("admissions.record.results")}
      </h2>
      {results.results.length === 0 ? (
        <EmptyLine>{t("admissions.record.resultsNone")}</EmptyLine>
      ) : (
        <ReadTable
          caption={t("admissions.record.resultsCaption")}
          rows={results.results}
          rowKey={(r) => r.publicationId}
          columns={[
            { key: "exam", label: t("admissions.record.resultExam"), primary: true, cell: (r) => resultName(r) },
            { key: "percent", label: t("admissions.record.resultPercent"), cell: (r) => percentText(r.card.body.percentHundredths) },
            {
              key: "result",
              label: t("admissions.record.resultResult"),
              cell: (r) => (r.card.body.kind === "final" ? (r.card.body.grade ?? t(r.card.body.passed ? "results.card.pass" : "results.card.fail")) : (r.card.body.grade ?? "—")),
            },
            { key: "card", label: t("admissions.record.resultCard"), align: "end", plain: true, cell: (r) => <OpenLink href={`/portal/results/card?id=${r.card.id}`} label={t("results.own.openCard")} text={t("admissions.record.resultCard")} /> },
          ]}
        />
      )}
    </section>
  );
}

/** Pure: the fees section of a record, or the line that says there is no account yet. */
export function RecordFeesView({ account, studentId, name }: { account: Account | null; studentId: string; name: string }) {
  return (
    <section className={readStyles.page} aria-labelledby="record-fees">
      <h2 id="record-fees" className={readStyles.panelTitle}>
        {t("admissions.record.fees")}
      </h2>
      {account ? (
        <>
          <AccountView account={account} />
          <OpenLink href={`/portal/fees/student?id=${studentId}`} label={t("admissions.record.feesOf", { name })} text={t("admissions.record.feesOpen")} />
        </>
      ) : (
        <EmptyLine>{t("admissions.record.noFees")}</EmptyLine>
      )}
    </section>
  );
}
