import { BookOpen, Building2, CalendarRange, GraduationCap, Library, Users, type LucideIcon } from "lucide-react";

import { t } from "@/i18n/messages";

import { termWords } from "../model";
import type { NodeKind, StructNode } from "./model";

export type Words = ReturnType<typeof termWords>;

/** One small, meaningful icon for each kind of box. */
export const ICONS: Record<NodeKind, LucideIcon> = { term: CalendarRange, wing: Building2, course: BookOpen, level: GraduationCap, subjects: Library, section: Users };

const many = (n: number, one: Parameters<typeof t>[0], more: Parameters<typeof t>[0]) => t(n === 1 ? one : more, { n });

/** What a kind of box is called, in the school's own words (wing, course, level, section can be renamed). */
export function kindWord(kind: NodeKind, words: Words): string {
  switch (kind) {
    case "term":
      return t("setup.map.term");
    case "wing":
      return words.section;
    case "course":
      return words.programme;
    case "level":
      return words.level;
    case "subjects":
      return t("setup.map.subjects");
    case "section":
      return words.classSection;
  }
}

/** A box's name: its own, and "Subjects" for the subjects. */
export function nodeTitle(node: StructNode): string {
  if (node.kind === "subjects") return t("setup.map.subjects");
  return node.name;
}

/** The counts on a box's second line, each its own piece so the box can set them apart. Pure. */
export function metaParts(node: StructNode): string[] {
  const { counts } = node;
  const sections = many(counts.sections, "classes.sectionsOne", "classes.sectionsMany");
  const students = many(counts.students, "classes.studentsOne", "classes.studentsMany");
  const courses = many(counts.courses, "structure.count.coursesOne", "structure.count.coursesMany");
  const classes = many(counts.classes, "structure.count.classesOne", "structure.count.classesMany");
  switch (node.kind) {
    case "term": {
      const exam = node.payload.kind === "term" ? node.payload.term.exam : null;
      return [
        many(node.children.length, "structure.count.wingsOne", "structure.count.wingsMany"),
        students,
        ...(exam ? [t("setup.map.examOutOf"), many(exam.terminals.length, "structure.count.examsOne", "structure.count.examsMany"), ...(exam.graded ? [t("structure.exam.graded")] : [])] : [t("setup.map.noExam")]),
      ];
    }
    case "wing":
      return [courses, classes, sections, students];
    case "course":
      return [classes, sections, students];
    case "level":
      return [sections, students];
    case "subjects":
      return node.payload.kind === "subjects" ? [many(node.payload.level.subjects.length, "structure.count.subjectsOne", "structure.count.subjectsMany")] : [];
    case "section":
      return node.payload.kind === "section" ? [students, node.payload.section.classTeacher ? t("setup.map.classTeacher", { name: node.payload.section.classTeacher }) : t("setup.map.noClassTeacher")] : [];
  }
}

/** The counts as one line, for the side panel's heading. Pure. */
export const metaLine = (node: StructNode): string => metaParts(node).join(" · ");

/** The subjects shown inside a subjects box: as many as fit, then "+3 more". Pure. */
export function subjectChips(names: readonly string[], fit = 6): { shown: string[]; more: number } {
  return { shown: names.slice(0, fit), more: Math.max(0, names.length - fit) };
}
