"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
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
export function StudentDetails({ student, feesLink = false, actions }: { student: StudentDetail; feesLink?: boolean; actions?: React.ReactNode }) {
  const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const rows: [string, string][] = [
    [t("admissions.record.sid"), student.sid],
    [t("admissions.record.class"), student.className ?? t("admissions.record.noClass")],
    [t("admissions.field.dob"), student.dobBs ? formatBsDate(student.dobBs) : student.dob],
    [t("admissions.field.phone"), student.phone ?? "—"],
    [t("admissions.field.email"), student.email ?? "—"],
    [t("admissions.field.guardianName"), student.guardianName],
    [t("admissions.field.guardianPhone"), student.guardianPhone],
    [t("admissions.field.previousSchool"), student.previousSchool ?? "—"],
  ];
  return (
    <>
      <ReadHeader
        title={name}
        subtitle={[student.sid, student.className].filter(Boolean).join(" · ")}
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
  const { term } = useConfig();
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
  const feesLink = roles.some((r) => r === "admin" || r === "accountant" || r === "super_admin");
  const reader = !roles.some((r) => r === "coordinator" || r === "super_admin");
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
      {reader ? <ReadOnlyNote>{t("admissions.record.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote> : null}
    </div>
  );
}
