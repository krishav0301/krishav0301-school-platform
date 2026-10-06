import type { SchoolClass } from "@/setup/model";

import type { ClassTeaching } from "./teaching-model";

/**
 * The Teaching page as the Principal reads it, redesigned (PM, 2026-10-06; UI only): each teacher with their subjects,
 * the classes they teach and the class they lead, apart; the subjects still without a teacher; the four figures.
 * Built from the same loads as before (D-104, D-108). Pure.
 */

export interface ClassRef {
  classId: string;
  /** "4th Semester (Evening)": the level and the class's section. */
  name: string;
  course: string;
  termId: string;
}
export interface SubjectRef {
  subject: string;
  course: string;
}
export interface TeacherCard {
  id: string;
  name: string;
  subjects: SubjectRef[];
  classes: ClassRef[];
  classTeacherOf: ClassRef[];
}
export interface MissingTeacher {
  key: string;
  subject: string;
  cls: ClassRef;
}
export interface TeachingBoard {
  teachers: TeacherCard[];
  missing: MissingTeacher[];
  figures: { teachers: number; assigned: number; subjects: number; classesTaught: number; classes: number; missing: number };
}

const classRef = (c: SchoolClass | undefined, teaching: ClassTeaching): ClassRef => ({
  classId: teaching.classId,
  name: c ? (c.label ? `${c.levelName} (${c.label})` : c.levelName) : teaching.levelName,
  course: c?.programmeName ?? "",
  termId: c?.yearId ?? "",
});

/** Every teacher in the term asked for ("" for every open term), by name; what is missing; the figures. Pure. */
export function teachingBoard(classes: readonly SchoolClass[], teachings: readonly ClassTeaching[], termId = ""): TeachingBoard {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const cards = new Map<string, TeacherCard>();
  const card = (id: string, name: string) => cards.get(id) ?? cards.set(id, { id, name, subjects: [], classes: [], classTeacherOf: [] }).get(id)!;
  const missing: MissingTeacher[] = [];
  let assigned = 0;
  let subjects = 0;
  let classesTaught = 0;
  let classCount = 0;
  for (const teaching of teachings) {
    const ref = classRef(byId.get(teaching.classId), teaching);
    if (termId && ref.termId !== termId) continue;
    classCount += 1;
    if (teaching.classTeacher) card(teaching.classTeacher.id, teaching.classTeacher.fullName).classTeacherOf.push(ref);
    let taught = false;
    for (const a of teaching.assignments) {
      subjects += 1;
      if (!a.teacher) {
        missing.push({ key: `${teaching.classId}-${a.offeringId}`, subject: a.subjectName, cls: ref });
        continue;
      }
      assigned += 1;
      taught = true;
      const c = card(a.teacher.id, a.teacher.fullName);
      if (!c.subjects.some((s) => s.subject === a.subjectName && s.course === ref.course)) c.subjects.push({ subject: a.subjectName, course: ref.course });
      if (!c.classes.some((x) => x.classId === ref.classId)) c.classes.push(ref);
    }
    if (taught) classesTaught += 1;
  }
  const teachers = [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { teachers, missing, figures: { teachers: teachers.length, assigned, subjects, classesTaught, classes: classCount, missing: missing.length } };
}

export type TeacherStatus = "" | "lead" | "notLead";

/** The cards that match a search (teacher, subject or class) and a status (leads a class, or not). Pure. */
export function filterTeachers(teachers: readonly TeacherCard[], q: string, status: TeacherStatus): TeacherCard[] {
  const words = q.trim().toLowerCase();
  return teachers.filter((x) => {
    if (status === "lead" && x.classTeacherOf.length === 0) return false;
    if (status === "notLead" && x.classTeacherOf.length > 0) return false;
    if (!words) return true;
    const texts = [x.name, ...x.subjects.flatMap((s) => [s.subject, s.course]), ...[...x.classes, ...x.classTeacherOf].flatMap((c) => [c.name, c.course])];
    return texts.some((text) => text.toLowerCase().includes(words));
  });
}

/** The subjects without a teacher that match a search (subject or class). Pure. */
export function filterMissing(missing: readonly MissingTeacher[], q: string): MissingTeacher[] {
  const words = q.trim().toLowerCase();
  if (!words) return [...missing];
  return missing.filter((m) => [m.subject, m.cls.name, m.cls.course].some((text) => text.toLowerCase().includes(words)));
}
