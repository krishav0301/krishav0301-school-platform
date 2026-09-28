"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Card, Notice } from "@/ui";

import styles from "./attendance.module.css";
import { loadOwn } from "./client";
import type { OwnAttendance } from "./model";

/** The student's own attendance on their dashboard (D-069): the percentage, the days, the flag, the days absent. */
export function OwnAttendanceCard() {
  const { api } = useSession();
  const [absentHere, setAbsentHere] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadOwn(api);
    // No enrollment this year, or attendance switched off: nothing to show, rather than an error.
    setAbsentHere(!result.ok && result.reason === "not_found");
    return result.ok ? result : ({ ok: false, reason: result.reason === "forbidden" ? "forbidden" : "failed" } as const);
  }, [api]);
  const { view, reload } = useLoad<OwnAttendance>(loadNow);
  if (view.status === "failed" && absentHere) return null;

  return (
    <Card aria-labelledby="own-attendance-heading">
      <h2 id="own-attendance-heading" className={setupStyles.subhead}>
        {t("attendance.own.title")}
      </h2>
      <Gate view={view} onRetry={() => void reload()}>
        {(own) =>
          own.percent === null ? (
            <p className={setupStyles.muted}>{t("attendance.own.nothingYet")}</p>
          ) : (
            <div className={setupStyles.page}>
              <div>
                <p className={styles.stat}>{t("attendance.own.percent", { percent: own.percent })}</p>
                <p className={setupStyles.muted}>{t("attendance.own.days", { present: own.present, absent: own.absent })}</p>
              </div>
              {own.below ? <Notice>{t("attendance.own.below", { threshold: own.threshold })}</Notice> : null}
              {own.absentDays.length > 0 ? (
                <div>
                  <p className={setupStyles.muted}>{t("attendance.own.absentDays")}</p>
                  <ul className={styles.days}>
                    {own.absentDays.map((d) => (
                      <li key={d.date}>
                        <Badge>{d.dateBs ?? d.date}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )
        }
      </Gate>
    </Card>
  );
}
