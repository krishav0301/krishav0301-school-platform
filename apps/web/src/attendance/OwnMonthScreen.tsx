"use client";

import { useCallback, useState } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Table } from "@/ui";

import styles from "./attendance.module.css";
import { gateFailure, loadOwnMonth } from "./client";
import { TEACHER_STATUS_LABEL, shiftMonth, type OwnTeacherMonth } from "./model";

const WEEKDAYS: readonly MessageKey[] = ["weekday.0", "weekday.1", "weekday.2", "weekday.3", "weekday.4", "weekday.5", "weekday.6"];

/** A teacher's own attendance, one BS month at a time, read-only (source 6.2). */
export function OwnMonthScreen() {
  const { api } = useSession();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const loadNow = useCallback(async () => {
    const result = await loadOwnMonth(api, month);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, month]);
  const { view, reload } = useLoad<OwnTeacherMonth>(loadNow);

  return (
    <>
      <h1 className={setupStyles.title}>{t("attendance.mine.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(data) => (
          <>
            <div className={styles.saveBar}>
              <Button className={styles.wrapLabel} variant="secondary" onClick={() => setMonth(shiftMonth(data.month, -1))}>
                {t("attendance.mine.previous")}
              </Button>
              <p className={styles.tally}>{data.month}</p>
              <Button className={styles.wrapLabel} variant="secondary" onClick={() => setMonth(shiftMonth(data.month, 1))}>
                {t("attendance.mine.next")}
              </Button>
            </div>
            <p>{t("attendance.mine.counts", { present: data.present, absent: data.absent, leave: data.leave })}</p>
            <Table caption={t("attendance.mine.title")}>
              <thead>
                <tr>
                  <th scope="col">{t("attendance.mine.day")}</th>
                  <th scope="col">{t("attendance.class.status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.date}>
                    <td>
                      {d.dateBs}
                      <br />
                      <span className={setupStyles.muted}>{t(WEEKDAYS[d.weekday]!)}</span>
                    </td>
                    <td>
                      {d.status === null ? (
                        t("attendance.class.none")
                      ) : d.status === "present" ? (
                        t(TEACHER_STATUS_LABEL.present)
                      ) : (
                        <Badge tone={d.status === "absent" ? "bad" : "neutral"}>{t(TEACHER_STATUS_LABEL[d.status])}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Gate>
    </>
  );
}
