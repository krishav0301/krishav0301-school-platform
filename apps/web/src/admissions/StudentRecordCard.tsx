"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Card } from "@/ui";

import styles from "./admissions.module.css";
import { loadOwnStudent, type Loaded } from "./client";
import type { StudentDetail } from "./model";

/** A Student's own record: personal details and current class, read-only (D-063). They cannot edit anything. */
export function StudentRecordCard() {
  const { api } = useSession();
  const [notAStudent, setNotAStudent] = useState(false);
  const loadNow = useCallback(async (): Promise<Loaded<StudentDetail>> => {
    const result = await loadOwnStudent(api);
    setNotAStudent(!result.ok && result.reason === "not_found");
    return result.ok ? result : { ok: false, reason: "failed" };
  }, [api]);
  const { view, reload } = useLoad(loadNow);

  // No student record for this sign-in: nothing to show. A genuine load failure still shows the
  // card, with its own retry, so a real problem is never mistaken for "not a student".
  if (view.status === "failed" && notAStudent) return null;

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
