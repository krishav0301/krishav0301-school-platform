import type { components } from "@/api/schema";
import { t, type MessageKey } from "@/i18n/messages";

export type AttendanceClassList = components["schemas"]["AttendanceClassList"];
export type AttendanceClass = AttendanceClassList["classes"][number];
export type AttendanceDay = components["schemas"]["AttendanceDay"];
export type AttendanceSummary = components["schemas"]["AttendanceSummary"];
export type OwnAttendance = components["schemas"]["OwnAttendance"];

type Naming = { programmeName: string; levelName: string; label: string };

/** "+2 Science · Grade 11", with the class's own label (Morning) when it has one. */
export function className(c: Naming): string {
  return c.label ? t("attendance.classNameLabel", { programme: c.programmeName, level: c.levelName, label: c.label }) : t("attendance.className", { programme: c.programmeName, level: c.levelName });
}

/** A student's line under their name: roll number when there is one, and the SID. */
export function studentMeta(s: { sid: string; rollNo: number | null }): string {
  return s.rollNo === null ? t("attendance.student.meta", { sid: s.sid }) : t("attendance.student.metaRoll", { roll: s.rollNo, sid: s.sid });
}

/** The absent set the register starts from: what was saved today, or nobody (everyone starts as present). */
export function initialAbsent(day: AttendanceDay): Set<string> {
  return new Set(day.students.filter((s) => s.status === "absent").map((s) => s.enrollmentId));
}

/** How many of the day's students are present and absent with this absent set. */
export function counts(day: AttendanceDay, absent: ReadonlySet<string>): { present: number; absent: number } {
  const marked = day.students.filter((s) => absent.has(s.enrollmentId)).length;
  return { present: day.students.length - marked, absent: marked };
}

export type TeacherDay = components["schemas"]["TeacherDay"];
export type TeacherStatus = TeacherDay["teachers"][number]["status"] & string;
export type OwnTeacherMonth = components["schemas"]["OwnTeacherMonth"];

/** The day's choices as the screen starts: what was saved, or Present for anyone not marked yet. */
export function initialStatuses(day: TeacherDay): Record<string, TeacherStatus> {
  return Object.fromEntries(day.teachers.map((teacher) => [teacher.id, teacher.status ?? "present"]));
}

/** The exceptions the API takes: everyone not Present. */
export function exceptionsOf(statuses: Record<string, TeacherStatus>): { teacherId: string; status: "absent" | "leave" }[] {
  return Object.entries(statuses).flatMap(([teacherId, status]) => (status === "present" ? [] : [{ teacherId, status }]));
}

/** A BS month "YYYY-MM" moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Each teacher mark's words, written out so the catalog's dead-word check can see every key in use. */
export const TEACHER_STATUS_LABEL: Record<TeacherStatus, MessageKey> = {
  present: "attendance.teacherStatus.present",
  absent: "attendance.teacherStatus.absent",
  leave: "attendance.teacherStatus.leave",
};
