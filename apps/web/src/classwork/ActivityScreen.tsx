"use client";

import { CircleAlert, CircleCheck, NotebookPen } from "lucide-react";
import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";

import { t } from "@/i18n/messages";
import { dayLine, EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice } from "@/ui";

import { ActivityPanel } from "./ActivityEditor";
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
      <div className={readStyles.page}>
        <ClassesToday />
        {roles.includes("teacher") ? <TeacherToday nested /> : null}
      </div>
    );
  if (roles.includes("teacher")) return <TeacherToday />;
  if (roles.includes("student")) return <StudentDays />;
  return null;
}

type Subject = MyActivityToday["subjects"][number];
const subjectKey = (s: Subject) => `${s.classId}-${s.offeringId}`;

/** A teacher's day: subjects written of those taught today, and those still to write. Pure. */
export function teacherLogFigures(today: MyActivityToday): Figure[] {
  const written = today.subjects.filter((s) => s.body !== null).length;
  return [
    { key: "written", icon: NotebookPen, tone: "ok", value: t("classwork.figure.writtenValue", { written, expected: today.subjects.length }), label: t("classwork.figure.yourWritten") },
    { key: "missing", icon: CircleAlert, tone: written < today.subjects.length ? "warn" : "ok", value: String(today.subjects.length - written), label: t("classwork.figure.yourMissing") },
  ];
}

/** Each subject the teacher teaches, what was written today or that nothing is yet, and Write or Change. Pure. */
export function TeacherSubjects({ subjects, onOpen }: { subjects: readonly Subject[]; onOpen?: (subject: Subject) => void }) {
  if (subjects.length === 0) return <EmptyLine>{t("classwork.activity.noSubjects")}</EmptyLine>;
  // Not written first: that is what the teacher came for.
  const ordered = [...subjects.filter((s) => s.body === null), ...subjects.filter((s) => s.body !== null)];
  return (
    <ul className={readStyles.rows}>
      {ordered.map((s) => (
        <li key={subjectKey(s)} className={readStyles.rowItem}>
          <div className={readStyles.rowHead}>
            <h3 className={readStyles.rowTitle}>{s.subjectName}</h3>
            <StatusWord tone={s.body === null ? "warn" : "ok"}>{t(s.body === null ? "classwork.activity.notWritten" : "classwork.activity.writtenWord")}</StatusWord>
          </div>
          <div className={readStyles.rowHead}>
            <p className={readStyles.rowMeta}>{className(s)}</p>
            {onOpen ? (
              <Button variant="quiet" className={`${styles.wrapLabel} ${styles.rowButton}`} onClick={() => onOpen(s)} aria-label={t(s.body === null ? "classwork.activity.writeFor" : "classwork.activity.changeFor", { subject: s.subjectName, name: className(s) })}>
                {t(s.body === null ? "dashboard.activity.write" : "classwork.activity.change")}
              </Button>
            ) : null}
          </div>
          {s.body !== null ? <p className={styles.body}>{s.body}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function TeacherToday({ nested = false }: { nested?: boolean }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadMyToday(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<MyActivityToday>(loadNow);
  const [open, setOpen] = useState<Subject | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const today = view.status === "ready" ? { ...view.data, subjects: view.data.subjects.map((s) => ({ ...s, body: bodies[subjectKey(s)] ?? s.body })) } : null;
  const content = (
    <>
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={nested ? 0 : 2} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {today ? (
        <>
          {nested || today.subjects.length === 0 ? null : <FigureTiles figures={teacherLogFigures(today)} label={t("classwork.figures")} />}
          {saved ? <Notice tone="ok">{saved}</Notice> : null}
          <Panel title={t(nested ? "classwork.activity.yourSubjects" : "classwork.activity.subjectsToday")} labelledBy="teacher-today">
            <p className={readStyles.rowMeta}>{t("classwork.activity.teacherIntro")}</p>
            <TeacherSubjects subjects={today.subjects} onOpen={(s) => { setSaved(null); setOpen(s); }} />
          </Panel>
          {open ? (
            <ActivityPanel
              subject={open}
              onClose={() => setOpen(null)}
              onSaved={(body) => {
                setBodies((current) => ({ ...current, [subjectKey(open)]: body }));
                setSaved(t("classwork.activity.savedFor", { subject: open.subjectName }));
                setOpen(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
  if (nested) return content;
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("classwork.activity.title")} subtitle={t("classwork.activity.teacherSubtitle")} dayBs={today ? dayLine(today.dateBs, true, today.date) : null} />
      {content}
    </div>
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
    <div className={readStyles.page}>
      <ReadHeader title={t("classwork.activity.title")} subtitle={t("classwork.activity.studentSubtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.days.length === 0 ? (
          <Panel>
            <EmptyLine>{t("classwork.activity.nothingYet")}</EmptyLine>
          </Panel>
        ) : (
          <DayList days={view.data.days} />
        )
      ) : null}
    </div>
  );
}

/** Days, newest first, each a panel with its subjects' entries. Shared by the student's view. */
export function DayList({ days }: { days: OwnActivity["days"] }) {
  return (
    <>
      {days.map((day) => (
        <Panel key={day.date} title={day.dateBs ? formatBsDate(day.dateBs) : day.date} labelledBy={`day-${day.date}`}>
          <ul className={readStyles.rows}>
            {day.entries.map((entry) => (
              <li key={entry.subjectName} className={readStyles.rowItem}>
                <div className={readStyles.rowHead}>
                  <h3 className={readStyles.rowTitle}>{entry.subjectName}</h3>
                  <span className={readStyles.rowMeta}>{entry.teacherName}</span>
                </div>
                <p className={styles.body}>{entry.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </>
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
