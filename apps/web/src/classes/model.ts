import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";

/** A class as one page (FUT point 19, D-116). */
export type ClassHubList = components["schemas"]["ClassHubList"];
export type ClassHubItem = ClassHubList["classes"][number];
export type ClassHub = components["schemas"]["ClassHub"];

export type ClassTab = "students" | "attendance" | "classwork" | "results";

/** "+2 · Science · Grade 11 · Section A": where a class sits, in the school's words. Pure. */
export const classPlace = (c: Pick<ClassHubItem, "wing" | "course" | "level" | "section">): string =>
  [c.wing, c.course, c.level, c.section ? t("classes.section", { name: c.section }) : null].filter(Boolean).join(" · ");

/**
 * The tabs a person sees, in order (the PM, FUT point 19): Students always; Attendance for the Class Teacher, the
 * Co-ordinator and the Principal; Classwork for staff and for a teacher who teaches a subject here (a teacher's classwork
 * is their own subjects only); Results always (every subject's published sheet, or a subject teacher's own marks). Pure.
 */
export function classTabs(hub: Pick<ClassHub, "viewer" | "taughtSubjects">): ClassTab[] {
  const tabs: ClassTab[] = ["students"];
  if (hub.viewer.attendance) tabs.push("attendance");
  if (hub.viewer.staff || hub.taughtSubjects.length > 0) tabs.push("classwork");
  tabs.push("results");
  return tabs;
}

/** The tab to show: the one asked for when the person may see it, else Students. Pure. */
export const pickTab = (tabs: readonly ClassTab[], asked: string | null): ClassTab => (tabs.includes(asked as ClassTab) ? (asked as ClassTab) : "students");
