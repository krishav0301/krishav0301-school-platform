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

export const nodeTitle = (node: StructNode): string => (node.kind === "subjects" ? t("setup.map.subjects") : node.name);

/** The second line of a box: counts that fit on one line. Pure. */
export function metaLine(node: StructNode): string {
  const { counts } = node;
  const sections = many(counts.sections, "classes.sectionsOne", "classes.sectionsMany");
  const students = many(counts.students, "classes.studentsOne", "classes.studentsMany");
  switch (node.kind) {
    case "term":
      return [many(node.children.length, "structure.count.wingsOne", "structure.count.wingsMany"), students].join(" · ");
    case "wing":
      return [many(counts.courses, "structure.count.coursesOne", "structure.count.coursesMany"), many(counts.classes, "structure.count.classesOne", "structure.count.classesMany"), sections, students].join(" · ");
    case "course":
      return [many(counts.classes, "structure.count.classesOne", "structure.count.classesMany"), sections, students].join(" · ");
    case "level":
      return [sections, students].join(" · ");
    case "subjects":
      return node.payload.kind === "subjects" ? many(node.payload.level.subjects.length, "structure.count.subjectsOne", "structure.count.subjectsMany") : "";
    case "section":
      return node.payload.kind === "section" ? [students, node.payload.section.classTeacher ? t("setup.map.classTeacher", { name: node.payload.section.classTeacher }) : t("setup.map.noClassTeacher")].join(" · ") : "";
  }
}
