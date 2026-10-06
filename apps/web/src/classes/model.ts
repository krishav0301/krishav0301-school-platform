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

// --- The grouped Classes page (PM, 2026-10-06): course, then level, then its sections ---------------------------------

export interface ClassFilters {
  q: string;
  wing: string;
  course: string;
  level: string;
  /** A section label; NO_SECTION for classes that have none. */
  section: string;
}
export const NO_CLASS_FILTERS: ClassFilters = { q: "", wing: "", course: "", level: "", section: "" };
export const NO_SECTION = "-";

export interface LevelGroup {
  levelId: string;
  name: string;
  termId: string;
  termLabel: string;
  classes: ClassHubItem[];
  students: number;
}
export interface CourseGroup {
  courseId: string;
  name: string;
  wing: string;
  levels: LevelGroup[];
  sections: number;
  students: number;
  /** Classes with no Class Teacher yet. */
  unassigned: number;
}

const matches = (c: ClassHubItem, f: ClassFilters): boolean => {
  if (f.wing && c.wing !== f.wing) return false;
  if (f.course && c.courseId !== f.course) return false;
  if (f.level && c.levelId !== f.level) return false;
  if (f.section && (c.section || NO_SECTION) !== f.section) return false;
  const q = f.q.trim().toLowerCase();
  if (q && ![c.wing, c.course, c.level, c.section, c.classTeacher ?? ""].some((text) => text.toLowerCase().includes(q))) return false;
  return true;
};

/** The classes that pass the filters, grouped course > level > class, in the order the server sent them. Pure. */
export function groupClasses(classes: readonly ClassHubItem[], filters: ClassFilters): CourseGroup[] {
  const courses: CourseGroup[] = [];
  for (const c of classes) {
    if (!matches(c, filters)) continue;
    let course = courses.find((g) => g.courseId === c.courseId);
    if (!course) courses.push((course = { courseId: c.courseId, name: c.course, wing: c.wing, levels: [], sections: 0, students: 0, unassigned: 0 }));
    let level = course.levels.find((l) => l.levelId === c.levelId);
    if (!level) course.levels.push((level = { levelId: c.levelId, name: c.level, termId: c.termId, termLabel: c.termLabel, classes: [], students: 0 }));
    level.classes.push(c);
    level.students += c.students;
    course.sections += 1;
    course.students += c.students;
    if (!c.classTeacher) course.unassigned += 1;
  }
  return courses;
}

/**
 * What each filter offers: wings; the courses of the chosen wing; the levels of the chosen course (else of the wing);
 * the sections of what is left. Each list is built from the classes that pass the filters above it. Pure.
 */
export function classFilterOptions(classes: readonly ClassHubItem[], f: ClassFilters) {
  const unique = <T,>(items: T[], key: (item: T) => string) => items.filter((item, i) => items.findIndex((other) => key(other) === key(item)) === i);
  const inWing = classes.filter((c) => !f.wing || c.wing === f.wing);
  const inCourse = inWing.filter((c) => !f.course || c.courseId === f.course);
  const inLevel = inCourse.filter((c) => !f.level || c.levelId === f.level);
  return {
    wings: unique(classes.map((c) => c.wing), (w) => w),
    courses: unique(inWing.map((c) => ({ id: c.courseId, name: c.course })), (c) => c.id),
    levels: unique(inCourse.map((c) => ({ id: c.levelId, name: c.level, course: c.course })), (l) => l.id),
    sections: unique(inLevel.map((c) => c.section || NO_SECTION), (s) => s),
  };
}

/** A changed filter clears the ones under it. Pure. */
export function nextClassFilters(current: ClassFilters, patch: Partial<ClassFilters>): ClassFilters {
  const next = { ...current, ...patch };
  if ("wing" in patch) return { ...next, course: "", level: "", section: "" };
  if ("course" in patch) return { ...next, level: "", section: "" };
  if ("level" in patch) return { ...next, section: "" };
  return next;
}

/** "Section" and "Sec", which schools type in front of a section's own name ("Section B", "Sec A"). */
const TYPED_PREFIX = /^(?:section|sec)\.?\s+/i;

/** A section label without a typed "Section" or "Sec", so "Section B" reads "B" before the word is added again. Pure. */
export function bareSection(section: string): string {
  const trimmed = section.trim();
  return trimmed.replace(TYPED_PREFIX, "") || trimmed;
}

/** The letter in a section's badge: its own first letter, or a dash for a class with no section. Pure. */
export const sectionBadge = (section: string): string => {
  const bare = bareSection(section);
  return bare ? bare[0]!.toUpperCase() : "–";
};
