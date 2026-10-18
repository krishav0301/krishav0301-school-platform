"use client";

import { CalendarCheck, CircleAlert, ClipboardList, GraduationCap, UserMinus } from "lucide-react";
import { useCallback, useState } from "react";

import { ClassFilterBar } from "@/classes/ClassFilterBar";
import { classFilterOptions, matches, NO_CLASS_FILTERS, type ClassFilters } from "@/classes/model";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { GROUP_TONES, GroupCard, GroupList } from "@/read/GroupCard";
import { dayLine, EmptyLine, FigureTiles, OpenLink, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
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

export interface ProgrammeGroup {
  courseId: string;
  programme: string;
  wing: string;
  classes: AttendanceClass[];
  students: number;
  notMarked: number;
  absent: number;
}

/** A class as the Classes page's search and filters read it: its department is the programme, its section the class label. */
const filterable = (c: AttendanceClass) => ({ ...c, course: c.programmeName, level: c.levelName, section: c.label });

/** The classes that pass the search and the four filters of Classes, by the very same rules (D-181). Pure. */
export const filterAttendanceClasses = (classes: readonly AttendanceClass[], filters: ClassFilters): AttendanceClass[] => classes.filter((c) => matches(filterable(c), filters));

/**
 * The classes grouped by programme, the grouping Classes uses (D-181): programmes in name order, the classes inside each
 * with the ones not marked yet first. The counts are the same ones the figures use: absent counts only marked classes. Pure.
 */
export function groupByProgramme(classes: readonly AttendanceClass[]): ProgrammeGroup[] {
  const groups = new Map<string, ProgrammeGroup>();
  for (const c of classesForOverview(classes)) {
    const g = groups.get(c.courseId) ?? { courseId: c.courseId, programme: c.programmeName, wing: c.wing, classes: [], students: 0, notMarked: 0, absent: 0 };
    g.classes.push(c);
    g.students += c.students;
    if (c.markedToday) g.absent += c.absentToday;
    else g.notMarked++;
    groups.set(c.courseId, g);
  }
  return [...groups.values()].sort((x, y) => x.programme.localeCompare(y.programme, undefined, { numeric: true }));
}

/**
 * The Classes page's list on the attendance screen (D-181): the same search box and four filters, then one programme card
 * each with its classes inside. Every programme card starts closed (PM, 2026-10-18); while a search or filter
 * is set every matching programme is open, as on Classes.
 */
export function ClassGroups({ classes }: { classes: readonly AttendanceClass[] }) {
  const [filters, setFilters] = useState<ClassFilters>(NO_CLASS_FILTERS);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const options = classFilterOptions(classes.map(filterable), filters);
  const groups = groupByProgramme(filterAttendanceClasses(classes, filters));
  const filtered = Object.values(filters).some(Boolean);
  const isOpen = (id: string) => toggled[id] ?? filtered;
  return (
    <>
      <ClassFilterBar filters={filters} options={options} onChange={setFilters} />
      {groups.length === 0 ? <EmptyLine>{t("classes.noneFound")}</EmptyLine> : null}
      <GroupList>
        {groups.map((g, i) => (
          <GroupCard
            key={g.courseId}
            title={g.programme}
            subtitle={g.wing}
            icon={<GraduationCap />}
            tone={GROUP_TONES[i % GROUP_TONES.length]!}
            stats={[
              { label: t("attendance.group.classes"), value: g.classes.length },
              { label: t("attendance.group.students"), value: g.students },
              { label: t("attendance.group.notMarked"), value: g.notMarked },
              { label: t("attendance.group.absent"), value: g.absent },
            ]}
            open={isOpen(g.courseId)}
            onToggle={() => setToggled((now) => ({ ...now, [g.courseId]: !isOpen(g.courseId) }))}
            toggleLabel={t(isOpen(g.courseId) ? "attendance.group.hide" : "attendance.group.show", { name: g.programme })}
          >
            <ClassesTable classes={g.classes} />
          </GroupCard>
        ))}
      </GroupList>
    </>
  );
}

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
                  <ClassGroups classes={others} />
                ) : null}
                {list.classes.length === 0 ? <EmptyLine>{overseer ? t("attendance.classes.empty") : t("attendance.classes.none")}</EmptyLine> : null}
              </>
            );
          })()
        : null}
    </div>
  );
}
