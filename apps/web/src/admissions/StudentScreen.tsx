"use client";

import Link from "next/link";
import { useCallback } from "react";

import { useAddressQuery } from "@/content/address";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Card, Notice } from "@/ui";

import styles from "./admissions.module.css";
import { loadStudent } from "./client";
import type { StudentDetail } from "./model";

/**
 * One student's personal record, read only, opened from Student search (admin FUT F-09). The server decides who may
 * see it and how far (`students.personal.view`, within the person's sections); nothing here can change it.
 */
export function StudentDetails({ student }: { student: StudentDetail }) {
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
    <Card aria-labelledby="student-name">
      <div className={setupStyles.badges}>
        <h1 id="student-name" className={setupStyles.title}>
          {name}
        </h1>
        {student.status !== "active" ? <Badge tone="bad">{t(student.status === "left" ? "admissions.student.left" : "admissions.student.graduated")}</Badge> : null}
      </div>
      <div className={styles.detailGrid}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className={styles.detailLabel}>{label}</p>
            <p className={styles.detailValue}>{value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StudentScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? null : new URLSearchParams(search).get("id");
  const load = useCallback(() => loadStudent(api, id ?? ""), [api, id]);
  const { view, reload } = useLoad(load);
  return (
    <>
      <Link href="/portal/admissions/search" className={setupStyles.tab}>
        {t("admissions.student.back")}
      </Link>
      {id === null && search !== null ? (
        <Notice tone="bad">{t("admissions.student.missing")}</Notice>
      ) : (
        <Gate view={view} onRetry={() => void reload()}>
          {(student) => <StudentDetails student={student} />}
        </Gate>
      )}
    </>
  );
}
