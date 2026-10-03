"use client";

import { CalendarCheck, CircleAlert, ClipboardList, UserMinus } from "lucide-react";
import { useCallback } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { dayLine, EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import { gateFailure, loadClasses, loadDay, loadTeacherDay } from "./client";
import { className, type AttendanceClass, type AttendanceClassList, type AttendanceDay, type TeacherDay } from "./model";
import { Register } from "./Register";

type Screen = { list: AttendanceClassList; mine: AttendanceDay[]; teachers: TeacherDay | null };

/**
 * The figures above the classes (D-103): how many are present today of the classes already marked, how many absent,
 * how many classes have not marked yet, and how many teachers are on leave. Only what the server gives.
 */
export function attendanceFigures(list: AttendanceClassList, teachers: TeacherDay | null): Figure[] {
  const marked = list.classes.filter((c) => c.markedToday);
  const students = marked.reduce((n, c) => n + c.students, 0);
  const absent = marked.reduce((n, c) => n + c.absentToday, 0);
  const notMarked = list.classes.length - marked.length;
  const figures: Figure[] = [
    { key: "present", icon: CalendarCheck, tone: "ok", value: students > 0 ? `${Math.round(((students - absent) / students) * 100)}%` : "—", label: t("attendance.figure.present") },
    { key: "absent", icon: UserMinus, tone: "bad", value: String(absent), label: t("attendance.figure.absent") },
    { key: "notMarked", icon: CircleAlert, tone: "warn", value: String(notMarked), label: t("attendance.figure.notMarked") },
  ];
  if (teachers) figures.push({ key: "leave", icon: ClipboardList, tone: "accent", value: String(teachers.teachers.filter((x) => x.status === "leave").length), label: t("attendance.figure.leave") });
  return figures;
}

/** Classes not marked yet come first: they are what the Principal looks for (D-103). The order is otherwise the school's own. */
export const classesForOverview = (classes: readonly AttendanceClass[]): AttendanceClass[] => [...classes.filter((c) => !c.markedToday), ...classes.filter((c) => c.markedToday)];

/** The classes, each with its Class Teacher and today's state, opening its register. Pure, so tests draw it. */
export function ClassesTable({ classes }: { classes: readonly AttendanceClass[] }) {
  return (
    <ReadTable
      caption={t("attendance.classes.title")}
      rows={classesForOverview(classes)}
      rowKey={(c) => c.id}
      columns={[
        { key: "class", label: t("attendance.col.class"), primary: true, cell: (c) => className(c) },
        { key: "teacher", label: t("attendance.col.classTeacher"), cell: (c) => c.classTeacher ?? t("attendance.noClassTeacher") },
        { key: "status", label: t("attendance.class.status"), cell: (c) => (c.markedToday ? <StatusWord tone="ok">{t("attendance.status.marked")}</StatusWord> : <StatusWord tone="warn">{t("attendance.classes.notMarked")}</StatusWord>) },
        { key: "summary", label: t("attendance.col.summary"), cell: (c) => (c.markedToday ? t("attendance.absentCount", { count: c.absentToday }) : "—") },
        { key: "open", label: t("attendance.col.open"), align: "end", plain: true, cell: (c) => <OpenLink href={`/portal/attendance/class?id=${c.id}`} label={t("attendance.classes.open", { name: className(c) })} /> },
      ]}
    />
  );
}

/**
 * Attendance (D-069; redesigned in D-103 after the PM's reference). A Class Teacher gets today's register for their
 * class first, as before. The Principal and the Co-ordinator get the day at a glance: figures, then every class of the
 * active year with its Class Teacher and today's state, the unmarked first, each opening its register.
 */
export function AttendanceScreen() {
  const { api, me } = useSession();
  const { config } = useConfig();
  const roles = me?.roles.map((r) => r.role) ?? [];
  // Staff who look at every class see "no classes yet"; a teacher sees why they have no register.
  const overseer = roles.some((r) => r !== "teacher" && r !== "student");
  const seesTeachers = config?.modules.teacher_attendance === true && roles.some((r) => r === "coordinator" || r === "admin" || r === "super_admin");
  const loadNow = useCallback(async () => {
    const [list, teachers] = await Promise.all([loadClasses(api), seesTeachers ? loadTeacherDay(api) : Promise.resolve(null)]);
    if (!list.ok) return gateFailure(list.reason);
    const mine = list.data.classes.filter((c) => c.mine);
    const days = await Promise.all(mine.map((c) => loadDay(api, c.id)));
    const failed = days.find((d) => !d.ok);
    if (failed && !failed.ok) return gateFailure(failed.reason);
    return { ok: true as const, data: { list: list.data, mine: days.flatMap((d) => (d.ok ? [d.data] : [])), teachers: teachers?.ok ? teachers.data : null } };
  }, [api, seesTeachers]);
  const { view, reload } = useLoad<Screen>(loadNow);
  const today = view.status === "ready" ? dayLine(view.data.list.todayBs, true, view.data.list.today) : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("attendance.title")} subtitle={t("attendance.subtitle")} dayBs={today} />
      {view.status === "loading" ? <TableSkeleton tiles={overseer ? 4 : 0} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready"
        ? (() => {
            const { list, mine, teachers } = view.data;
            const others = list.classes.filter((c) => !c.mine);
            return (
              <>
                {mine.map((day) => (
                  <Register key={day.class.id} day={day} />
                ))}
                {overseer && list.classes.length > 0 ? <FigureTiles figures={attendanceFigures(list, teachers)} label={t("attendance.figures")} /> : null}
                {others.length > 0 ? (
                  <Panel title={t("attendance.classes.title")} labelledBy="attendance-classes">
                    <ClassesTable classes={others} />
                  </Panel>
                ) : null}
                {list.classes.length === 0 ? <EmptyLine>{overseer ? t("attendance.classes.empty") : t("attendance.classes.none")}</EmptyLine> : null}
              </>
            );
          })()
        : null}
    </div>
  );
}
