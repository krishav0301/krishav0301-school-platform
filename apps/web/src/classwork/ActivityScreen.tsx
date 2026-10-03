"use client";

import { CircleAlert, CircleCheck, NotebookPen } from "lucide-react";
import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { dayLine, EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";

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
  // Whoever reads every class gets the day at a glance first, under the page's one heading (D-104).
  if (overseer)
    return (
      <>
        <ClassesToday />
        {roles.includes("teacher") ? <TeacherToday /> : null}
      </>
    );
  return (
    <>
      <h1 className={setupStyles.title}>{t("classwork.activity.title")}</h1>
      {roles.includes("teacher") ? <TeacherToday /> : null}
      {roles.includes("student") ? <StudentDays /> : null}
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

/** Classes with a subject not written yet come first; the order is otherwise the school's own (D-104). */
export const classesByGaps = (classes: ActivityClassList["classes"]): ActivityClassList["classes"] => [
  ...classes.filter((c) => c.expected > c.written),
  ...classes.filter((c) => c.expected <= c.written),
];

/** The figures above the classes: subjects written of those expected, classes complete, subjects with nothing yet. */
export function classworkFigures(list: ActivityClassList): Figure[] {
  const expected = list.classes.reduce((n, c) => n + c.expected, 0);
  const written = list.classes.reduce((n, c) => n + Math.min(c.written, c.expected), 0);
  const complete = list.classes.filter((c) => c.expected > 0 && c.written >= c.expected).length;
  return [
    { key: "written", icon: NotebookPen, tone: "ok", value: t("classwork.figure.writtenValue", { written, expected }), label: t("classwork.figure.written") },
    { key: "complete", icon: CircleCheck, tone: "accent", value: t("classwork.figure.writtenValue", { written: complete, expected: list.classes.length }), label: t("classwork.figure.complete") },
    { key: "missing", icon: CircleAlert, tone: "warn", value: String(expected - written), label: t("classwork.figure.missing") },
  ];
}

/** Every class today: how many subjects are written, what is still missing and by whom, each opening its log. Pure. */
export function ClassworkTable({ list, missing }: { list: ActivityClassList; missing: MissingActivity }) {
  const missingBy = new Map(missing.classes.map((c) => [c.classId, c.missing]));
  return (
    <ReadTable
      caption={t("classwork.activity.classesTitle")}
      rows={classesByGaps(list.classes)}
      rowKey={(c) => c.classId}
      columns={[
        { key: "class", label: t("attendance.col.class"), primary: true, cell: (c) => className(c) },
        { key: "written", label: t("classwork.col.written"), cell: (c) => (c.expected === 0 ? t("classwork.activity.noTeachers") : t("classwork.activity.written", { written: c.written, expected: c.expected })) },
        {
          key: "status",
          label: t("attendance.class.status"),
          cell: (c) =>
            c.expected === 0 ? <StatusWord>{t("classwork.status.none")}</StatusWord> : c.written >= c.expected ? <StatusWord tone="ok">{t("classwork.status.complete")}</StatusWord> : <StatusWord tone="warn">{t("classwork.status.missing", { count: c.expected - c.written })}</StatusWord>,
        },
        {
          key: "missing",
          label: t("classwork.col.missing"),
          cell: (c) => {
            const gaps = missingBy.get(c.classId) ?? [];
            return gaps.length === 0 ? "—" : gaps.map((g) => `${g.subjectName} (${g.teacherName})`).join(", ");
          },
        },
        { key: "open", label: t("classwork.col.open"), align: "end", plain: true, cell: (c) => <OpenLink href={`/portal/classwork/class?id=${c.classId}`} label={t("classwork.open", { name: className(c) })} /> },
      ]}
    />
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
  const today = view.status === "ready" ? dayLine(view.data.classes.dateBs, true, view.data.classes.date) : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("classwork.title")} subtitle={t("classwork.subtitle")} dayBs={today} />
      {view.status === "loading" ? <TableSkeleton tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.classes.classes.length === 0 ? (
          <EmptyLine>{t("classwork.activity.noClasses")}</EmptyLine>
        ) : (
          <>
            <FigureTiles figures={classworkFigures(view.data.classes)} label={t("classwork.figures")} />
            <Panel title={t("classwork.activity.classesTitle")} labelledBy="classes-today">
              <ClassworkTable list={view.data.classes} missing={view.data.missing} />
            </Panel>
            <ReadOnlyNote>{t("classwork.readOnlyNote")}</ReadOnlyNote>
          </>
        )
      ) : null}
    </div>
  );
}
