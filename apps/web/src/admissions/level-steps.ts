import type { OpenLevel } from "./model";

/**
 * "Applying for", chosen by Wing, then Course, then Level (D-114, FUT point 14), from the open levels the form is given.
 * A step with one choice is made for the person (D-030). Pure, so the steps are tested without a screen.
 */
export interface LevelChoice {
  sectionKey: string | null;
  programmeId: string | null;
  levelId: string | null;
}

export interface LevelSteps {
  wings: { key: string; name: string }[];
  courses: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  choice: LevelChoice;
}

const unique = <T, K>(items: readonly T[], key: (item: T) => K): T[] => {
  const seen = new Set<K>();
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
};

/** What each step offers for a choice, and the choice made whole where a step has one entry. */
export function levelSteps(open: readonly OpenLevel[], wanted: LevelChoice): LevelSteps {
  const wings = unique(open, (l) => l.sectionKey).map((l) => ({ key: l.sectionKey, name: l.sectionName }));
  const sectionKey = wings.some((w) => w.key === wanted.sectionKey) ? wanted.sectionKey : wings.length === 1 ? wings[0]!.key : null;
  const inWing = open.filter((l) => l.sectionKey === sectionKey);
  const courses = unique(inWing, (l) => l.programmeId).map((l) => ({ id: l.programmeId, name: l.programmeName }));
  const programmeId = courses.some((c) => c.id === wanted.programmeId) ? wanted.programmeId : courses.length === 1 ? courses[0]!.id : null;
  const levels = inWing.filter((l) => l.programmeId === programmeId).map((l) => ({ id: l.id, name: l.name }));
  const levelId = levels.some((l) => l.id === wanted.levelId) ? wanted.levelId : levels.length === 1 ? levels[0]!.id : null;
  return { wings, courses, levels, choice: { sectionKey, programmeId, levelId } };
}

/** Where an open level sits, so a form that already has a level shows its wing and course. */
export function choiceForLevel(open: readonly OpenLevel[], levelId: string): LevelChoice {
  const level = open.find((l) => l.id === levelId);
  return level ? { sectionKey: level.sectionKey, programmeId: level.programmeId, levelId: level.id } : { sectionKey: null, programmeId: null, levelId: null };
}
