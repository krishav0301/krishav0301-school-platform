"use client";

import Link from "next/link";
import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Notice } from "@/ui";

import { ActivityEditor } from "./ActivityEditor";
import styles from "./classwork.module.css";
import { gateFailure, loadActivityClasses, loadMissing, loadMyToday, loadOwnActivity } from "./client";
import { className, type ActivityClassList, type MissingActivity, type MyActivityToday, type OwnActivity } from "./model";

/**
 * The daily activity log (D-071), one screen for every role: a teacher writes today's entry for each subject they
 * teach; a student reads their class's last two weeks; the Co-ordinator and the Admin see each class's day, with
 * what is still missing.
 */
export function ActivityScreen() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const overseer = roles.some((r) => r === "coordinator" || r === "admin" || r === "super_admin");
  return (
    <>
      <h1 className={setupStyles.title}>{t("classwork.activity.title")}</h1>
      {roles.includes("teacher") ? <TeacherToday /> : null}
      {roles.includes("student") ? <StudentDays /> : null}
      {overseer ? <ClassesToday /> : null}
    </>
  );
}

function TeacherToday() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadMyToday(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<MyActivityToday>(loadNow);
  return (
    <section aria-labelledby="teacher-today" className={setupStyles.page}>
      <Gate view={view} onRetry={() => void reload()}>
        {(today) => (
          <>
            <div>
              <h2 id="teacher-today" className={setupStyles.subhead}>
                {t("classwork.activity.today", { date: today.dateBs ?? today.date })}
              </h2>
              <p className={setupStyles.muted}>{t("classwork.activity.teacherIntro")}</p>
            </div>
            {today.subjects.length === 0 ? (
              <p className={setupStyles.empty}>{t("classwork.activity.noSubjects")}</p>
            ) : (
              <ul className={styles.list}>
                {today.subjects.map((subject) => (
                  <ActivityEditor key={`${subject.classId}-${subject.offeringId}`} subject={subject} />
                ))}
              </ul>
            )}
          </>
        )}
      </Gate>
    </section>
  );
}

function StudentDays() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadOwnActivity(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<OwnActivity>(loadNow);
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(own) => (own.days.length === 0 ? <p className={setupStyles.empty}>{t("classwork.activity.nothingYet")}</p> : <DayList days={own.days} />)}
    </Gate>
  );
}

/** Days, newest first, each with its subjects' entries. Shared by the student's view. */
export function DayList({ days }: { days: OwnActivity["days"] }) {
  return (
    <ul className={styles.list}>
      {days.map((day) => (
        <li key={day.date}>
          <section aria-labelledby={`day-${day.date}`} className={styles.card}>
            <h2 id={`day-${day.date}`} className={setupStyles.subhead}>
              {day.dateBs ?? day.date}
            </h2>
            {day.entries.map((entry) => (
              <div key={entry.subjectName}>
                <h3>{entry.subjectName}</h3>
                <p className={styles.meta}>{entry.teacherName}</p>
                <p className={styles.body}>{entry.body}</p>
              </div>
            ))}
          </section>
        </li>
      ))}
    </ul>
  );
}

function ClassesToday() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const [classes, missing] = await Promise.all([loadActivityClasses(api), loadMissing(api)]);
    if (!classes.ok) return gateFailure(classes.reason);
    if (!missing.ok) return gateFailure(missing.reason);
    return { ok: true as const, data: { classes: classes.data, missing: missing.data } };
  }, [api]);
  const { view, reload } = useLoad<{ classes: ActivityClassList; missing: MissingActivity }>(loadNow);
  return (
    <section aria-labelledby="classes-today" className={setupStyles.page}>
      <Gate view={view} onRetry={() => void reload()}>
        {({ classes, missing }) => {
          const missingBy = new Map(missing.classes.map((c) => [c.classId, c.missing]));
          return (
            <>
              <div>
                <h2 id="classes-today" className={setupStyles.subhead}>
                  {t("classwork.activity.classesTitle")}
                </h2>
                <p className={setupStyles.muted}>{t("classwork.activity.today", { date: classes.dateBs ?? classes.date })}</p>
              </div>
              {classes.classes.length === 0 ? (
                <Notice>{t("classwork.activity.noClasses")}</Notice>
              ) : (
                <ul className={setupStyles.list}>
                  {classes.classes.map((c) => {
                    const gaps = missingBy.get(c.classId) ?? [];
                    return (
                      <li key={c.classId} className={setupStyles.item}>
                        <h3 className={setupStyles.itemTitle}>
                          <Link href={`/portal/classwork/class?id=${c.classId}`}>{className(c)}</Link>
                        </h3>
                        <div className={setupStyles.badges}>
                          {c.expected === 0 ? (
                            <Badge>{t("classwork.activity.noTeachers")}</Badge>
                          ) : (
                            <Badge tone={gaps.length === 0 ? "ok" : "neutral"}>{t("classwork.activity.written", { written: c.written, expected: c.expected })}</Badge>
                          )}
                        </div>
                        {gaps.length > 0 ? (
                          <p className={styles.meta}>{t("classwork.activity.missing", { list: gaps.map((g) => `${g.subjectName} (${g.teacherName})`).join(", ") })}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        }}
      </Gate>
    </section>
  );
}
