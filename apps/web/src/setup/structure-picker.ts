import type { Level, Programme } from "./model";

/**
 * Choosing a level by its place in the school (D-114, FUT points 4, 9, 14): first the Wing, then the Course, then the
 * Level. Pure helpers, so the screens that need a level (a term, the curriculum, an admission) agree on what is offered.
 * Only switched-on wings, courses and levels are offered, and only where `keep` leaves at least one level.
 */

export interface Wing {
  key: string;
  name: string;
}

export interface StructureChoice {
  sectionKey: string | null;
  programmeId: string | null;
  levelId: string | null;
}

export const emptyChoice: StructureChoice = { sectionKey: null, programmeId: null, levelId: null };

export type KeepLevel = (level: Level, programme: Programme) => boolean;
const keepAll: KeepLevel = () => true;

/** The levels of a course that may be offered: switched on, and kept. */
export const levelsOf = (programme: Programme, keep: KeepLevel = keepAll): Level[] => (programme.active ? programme.levels.filter((l) => l.active && keep(l, programme)) : []);

/** The courses of a wing that have a level to offer, in the API's order. */
export const coursesOf = (programmes: readonly Programme[], sectionKey: string, keep: KeepLevel = keepAll): Programme[] =>
  programmes.filter((p) => p.section.key === sectionKey && levelsOf(p, keep).length > 0);

/** The wings that have a course with a level to offer, in the order their courses come. */
export function wingsOf(programmes: readonly Programme[], keep: KeepLevel = keepAll): Wing[] {
  const seen = new Map<string, Wing>();
  for (const p of programmes) if (!seen.has(p.section.key) && levelsOf(p, keep).length > 0) seen.set(p.section.key, { key: p.section.key, name: p.section.name });
  return [...seen.values()];
}

/**
 * The choice made whole where there is nothing to choose (D-030: a menu of one entry is not shown): one wing, one course
 * in the chosen wing, one level in the chosen course. A choice that is no longer offered is cleared, with what follows it.
 */
export function settle(programmes: readonly Programme[], choice: StructureChoice, keep: KeepLevel = keepAll): StructureChoice {
  const wings = wingsOf(programmes, keep);
  const sectionKey = wings.some((w) => w.key === choice.sectionKey) ? choice.sectionKey : wings.length === 1 ? wings[0]!.key : null;
  if (!sectionKey) return emptyChoice;
  const courses = coursesOf(programmes, sectionKey, keep);
  const programmeId = courses.some((p) => p.id === choice.programmeId) ? choice.programmeId : courses.length === 1 ? courses[0]!.id : null;
  if (!programmeId) return { sectionKey, programmeId: null, levelId: null };
  const levels = levelsOf(courses.find((p) => p.id === programmeId)!, keep);
  const levelId = levels.some((l) => l.id === choice.levelId) ? choice.levelId : levels.length === 1 ? levels[0]!.id : null;
  return { sectionKey, programmeId, levelId };
}

/** Where a level sits: its wing, course and itself, or the empty choice when it is not known. */
export function choiceOf(programmes: readonly Programme[], levelId: string | null): StructureChoice {
  if (!levelId) return emptyChoice;
  for (const p of programmes) if (p.levels.some((l) => l.id === levelId)) return { sectionKey: p.section.key, programmeId: p.id, levelId };
  return emptyChoice;
}

interface TermLike {
  status: "draft" | "active" | "closed";
  levels: readonly { id: string }[];
}

/** The levels some open (draft or active) term runs: the ones a school is working with now (D-114). */
export function openTermLevelIds(terms: readonly TermLike[]): Set<string> {
  const ids = new Set<string>();
  for (const term of terms) if (term.status !== "closed") for (const l of term.levels) ids.add(l.id);
  return ids;
}

/** The open term a level is in: at most one (D-110), so its classes are that term's. Null when none runs it. */
export function openTermOf<T extends TermLike>(terms: readonly T[], levelId: string): T | null {
  return terms.find((term) => term.status !== "closed" && term.levels.some((l) => l.id === levelId)) ?? null;
}
