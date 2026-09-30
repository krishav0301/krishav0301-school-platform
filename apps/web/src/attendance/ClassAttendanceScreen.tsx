"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Notice } from "@/ui";

import styles from "./attendance.module.css";
import { gateFailure, loadDay, loadSummary } from "./client";
import { className, studentMeta, type AttendanceDay, type AttendanceSummary } from "./model";
import { Register } from "./Register";


/** One class (`?id=`): a day's register (today, or a day picked in BS) and each student's year so far. */
export function ClassAttendanceScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [bs, setBs] = useState("");
  const [badDay, setBadDay] = useState(false);

  const loadNow = useCallback(async () => {
    if (!id) return { ok: false as const, reason: "failed" as const };
    const [day, summary] = await Promise.all([loadDay(api, id, date), loadSummary(api, id)]);
    if (!day.ok) return gateFailure(day.reason);
    if (!summary.ok) return gateFailure(summary.reason);
    return { ok: true as const, data: { day: day.data, summary: summary.data } };
  }, [api, id, date]);
  const { view, reload } = useLoad<{ day: AttendanceDay; summary: AttendanceSummary }>(loadNow);

  async function show() {
    const result = await toAd(api, bs.trim());
    setBadDay(!result.ok);
    if (result.ok) setDate(result.ad);
  }

  return (
    <div className={setupStyles.page}>
      <p>
        <Link href="/portal/attendance">{t("attendance.class.back")}</Link>
      </p>
      <Gate view={view} onRetry={() => void reload()}>
        {({ day, summary }) => (
          <>
            <h1 className={setupStyles.title}>{className(day.class)}</h1>
            {day.canMark ? (
              <Register day={day} onSaved={() => void reload()} />
            ) : (
              <section className={styles.register} aria-labelledby="day-heading">
                <h2 id="day-heading" className={setupStyles.subhead}>
                  {t("attendance.class.dayTitle")}
                </h2>
                <div className={styles.dayPicker}>
                  <BsDateField legend={t("attendance.class.otherDay")} hint={t("attendance.class.pickDayHint")} error={badDay ? t("attendance.class.badDay") : undefined} value={bs} onChange={setBs} />
                  <Button className={styles.wrapLabel} variant="secondary" onClick={() => void show()}>
                    {t("attendance.class.show")}
                  </Button>
                </div>
                <p className={setupStyles.muted}>{day.dateBs ?? day.date}</p>
                {day.marked ? (
                  <ul className={styles.roster}>
                    {day.students.map((s) => (
                      <li key={s.enrollmentId} className={`${styles.rosterRow} ${styles.readRow}`}>
                        <span>
                          {s.name}
                          <br />
                          <span className={setupStyles.muted}>{studentMeta(s)}</span>
                        </span>
                        <span>{s.status === "absent" ? <Badge tone="bad">{t("attendance.class.absent")}</Badge> : s.status === "present" ? t("attendance.class.present") : t("attendance.class.none")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={setupStyles.empty}>{t("attendance.class.notMarked")}</p>
                )}
              </section>
            )}
            <SummaryTable summary={summary} />
          </>
        )}
      </Gate>
    </div>
  );
}

function SummaryTable({ summary }: { summary: AttendanceSummary }) {
  const flagged = summary.students.filter((s) => s.below).length;
  return (
    <section aria-labelledby="summary-heading" className={setupStyles.page}>
      <div>
        <h2 id="summary-heading" className={setupStyles.subhead}>
          {t("attendance.summary.title")}
        </h2>
        <p className={setupStyles.muted}>{t("attendance.summary.intro", { threshold: summary.threshold })}</p>
      </div>
      {flagged > 0 ? <Notice>{t("attendance.summary.flagged", { count: flagged, threshold: summary.threshold })}</Notice> : null}
      <ul className={`${styles.register} ${styles.roster}`}>
        {summary.students.map((s) => (
          <li key={s.enrollmentId} className={`${styles.rosterRow} ${styles.readRow}`}>
            <span>
              {s.name}
              <br />
              <span className={setupStyles.muted}>{studentMeta(s)}</span>
            </span>
            <span className={styles.numeric}>
              {s.percent === null ? t("attendance.summary.noDays") : `${s.percent}%`}
              {s.percent === null ? null : (
                <>
                  <br />
                  <span className={setupStyles.muted}>{t("attendance.summary.daysOf", { present: s.present, marked: s.present + s.absent })}</span>
                </>
              )}
              {s.below ? (
                <>
                  <br />
                  <Badge tone="bad">{t("attendance.summary.below", { threshold: summary.threshold })}</Badge>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
