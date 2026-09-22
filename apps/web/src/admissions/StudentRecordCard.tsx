"use client";

import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Card } from "@/ui";

import styles from "./admissions.module.css";
import { loadOwnStudent, type Loaded } from "./client";
import type { StudentDetail } from "./model";

/** Adapts `loadOwnStudent`'s three-way result to the generic `Loaded<T>` `Gate` expects: no record is treated as failure, and the card simply does not render. */
async function loadForCard(api: Parameters<typeof loadOwnStudent>[0]): Promise<Loaded<StudentDetail>> {
  const result = await loadOwnStudent(api);
  return result.ok ? result : { ok: false, reason: "failed" };
}

/** A Student's own record: personal details and current class, read-only (D-063). They cannot edit anything. */
export function StudentRecordCard() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadForCard(api), [api]);
  const { view, reload } = useLoad(loadNow);

  if (view.status === "failed") return null; // no student record for this sign-in: nothing to show

  return (
    <Card aria-labelledby="student-record-heading">
      <h2 id="student-record-heading" className={setupStyles.subhead}>
        {t("admissions.record.title")}
      </h2>
      <Gate view={view} onRetry={() => void reload()}>
        {(student) => (
          <div className={styles.detailGrid}>
            <div>
              <p className={styles.detailLabel}>{t("admissions.record.sid")}</p>
              <p className={styles.detailValue}>
                <Badge>{student.sid}</Badge>
              </p>
            </div>
            <div>
              <p className={styles.detailLabel}>{t("admissions.record.class")}</p>
              <p className={styles.detailValue}>{student.className ?? t("admissions.record.noClass")}</p>
            </div>
            <div>
              <p className={styles.detailLabel}>{t("admissions.field.dob")}</p>
              <p className={styles.detailValue}>{student.dobBs ?? student.dob}</p>
            </div>
            <div>
              <p className={styles.detailLabel}>{t("admissions.field.guardianName")}</p>
              <p className={styles.detailValue}>{student.guardianName}</p>
            </div>
          </div>
        )}
      </Gate>
    </Card>
  );
}
