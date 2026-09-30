import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";

export type MyActivityToday = components["schemas"]["MyActivityToday"];
export type ClassActivityDay = components["schemas"]["ClassActivityDay"];
export type OwnActivity = components["schemas"]["OwnActivity"];
export type MissingActivity = components["schemas"]["MissingActivity"];
export type ActivityClassList = components["schemas"]["ActivityClassList"];

type Naming = { programmeName: string; levelName: string; label: string };

/** "+2 Science · Grade 11", with the class's own label when it has one. */
export function className(c: Naming): string {
  return c.label ? t("classwork.classNameLabel", { programme: c.programmeName, level: c.levelName, label: c.label }) : t("classwork.className", { programme: c.programmeName, level: c.levelName });
}

/** The longest entry the API takes. */
export const ACTIVITY_MAX = 2000;

export type TeacherNotes = components["schemas"]["TeacherNotes"];
export type StudentNotes = components["schemas"]["StudentNotes"];
export type TeacherAssignments = components["schemas"]["TeacherAssignments"];
export type AssignmentDetail = components["schemas"]["AssignmentDetail"];
export type StudentAssignments = components["schemas"]["StudentAssignments"];
export type Submission = NonNullable<StudentAssignments["assignments"][number]["submission"]>;
export type Subject = MyActivityToday["subjects"][number];

/** A subject a teacher teaches in a class, as one choice ("Physics · Science · Grade 11") keyed by both ids. */
export const subjectKey = (s: { classId: string; offeringId: string }) => `${s.classId}:${s.offeringId}`;
export const subjectChoice = (s: Subject) => ({ value: subjectKey(s), label: `${s.subjectName} · ${className(s)}` });

/** A deadline as the teacher gives it: the BS day (already converted to AD) and a Nepal time, as one instant. */
export function dueInstant(adDay: string, time: string): string {
  return `${adDay}T${time}:00+05:45`;
}

/** Nepal's wall-clock time of an instant, "HH:MM". Formatting only; no calendar conversion. */
export function nepalTime(instant: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant));
}

/** The words for a submission's state, as the student and the teacher read it. */
export const SUBMISSION_STATUS: Record<Submission["status"], "classwork.work.status.submitted" | "classwork.work.status.reviewed" | "classwork.work.status.requested" | "classwork.work.status.allowed"> = {
  submitted: "classwork.work.status.submitted",
  reviewed: "classwork.work.status.reviewed",
  resubmit_requested: "classwork.work.status.requested",
  resubmit_allowed: "classwork.work.status.allowed",
};
