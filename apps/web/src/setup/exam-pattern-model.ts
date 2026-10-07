import type { ExamPatternInput } from "./client";
import type { ExamPattern } from "./model";

/**
 * The exam pattern screen's draft (D-132). The server saves a whole pattern at once and refuses one whose weights do not
 * add up to 100 (D-117), so adding, changing and removing exams happens on a draft kept in the browser, and the person
 * saves it once it adds up. Everything the screen shows (counts, totals, what is left, whether it is complete or locked)
 * is worked out here from the draft, never typed in.
 */

export interface DraftExam {
  /** The saved exam's id; none for one added in this session. */
  id?: string;
  name: string;
  weight: number;
  hasPractical: boolean;
}

export interface GradeBand {
  grade: string;
  from: string;
}

export interface Settings {
  graded: boolean;
  theoryMin: string;
  practicalMin: string;
  bands: GradeBand[];
}

export interface Draft {
  exams: DraftExam[];
  settings: Settings;
}

export const MAX_EXAMS = 12;
export const TOTAL_WEIGHT = 100;
export const DEFAULT_THEORY_MIN = "35";
export const DEFAULT_PRACTICAL_MIN = "40";

/** A whole percent from 0 to 100, or null. */
export const wholePercent = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text.trim()) <= 100 ? Number(text.trim()) : null);

/** The draft that matches what the server holds (or the starting point when it holds no pattern yet). */
export function draftFrom(saved: ExamPattern): Draft {
  const p = saved.pattern;
  return {
    exams: saved.terminals.map((x) => ({ id: x.id, name: x.name, weight: x.weight ?? 0, hasPractical: x.hasPractical })),
    settings: {
      graded: p?.graded ?? false,
      theoryMin: String(p?.theoryMinPercent ?? DEFAULT_THEORY_MIN),
      practicalMin: String(p?.practicalMinPercent ?? DEFAULT_PRACTICAL_MIN),
      bands: p?.gradeBands ? p.gradeBands.map((b) => ({ grade: b.grade, from: String(b.from) })) : [{ grade: "", from: "" }],
    },
  };
}

export const totalWeight = (exams: readonly DraftExam[]): number => exams.reduce((sum, x) => sum + x.weight, 0);

/** What is left to hand out, never below zero. */
export const remainingWeight = (exams: readonly DraftExam[]): number => Math.max(0, TOTAL_WEIGHT - totalWeight(exams));

export type PatternState = "empty" | "incomplete" | "over" | "complete";

/** Where the draft stands: nothing yet, still short of 100, past 100, or exactly 100. */
export function patternState(exams: readonly DraftExam[]): PatternState {
  if (exams.length === 0) return "empty";
  const total = totalWeight(exams);
  return total === TOTAL_WEIGHT ? "complete" : total < TOTAL_WEIGHT ? "incomplete" : "over";
}

/** The same exam name, ignoring case and spaces around it. */
const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export type ExamProblem = { field: "name"; reason: "required" | "duplicate" } | { field: "weight"; reason: "required" | "notWhole" | "zero" | "tooMuch"; remaining?: number };

/**
 * What is wrong with an exam being added (`editing` undefined) or changed (`editing` is its place in the list), in the
 * order the form shows it. `weight` is the text typed. Null when it can be saved into the draft.
 */
export function examProblem(exams: readonly DraftExam[], input: { name: string; weight: string }, editing?: number): ExamProblem | null {
  if (!input.name.trim()) return { field: "name", reason: "required" };
  if (exams.some((x, i) => i !== editing && sameName(x.name, input.name))) return { field: "name", reason: "duplicate" };
  const typed = input.weight.trim();
  if (typed === "") return { field: "weight", reason: "required" };
  if (!/^\d{1,3}$/.test(typed)) return { field: "weight", reason: "notWhole" };
  const weight = Number(typed);
  if (weight === 0) return { field: "weight", reason: "zero" };
  const others = exams.filter((_, i) => i !== editing);
  const remaining = remainingWeight(others);
  if (weight > remaining) return { field: "weight", reason: "tooMuch", remaining };
  return null;
}

/** The weight typed, when it is a usable whole number (for the live "what is left" line). */
export const typedWeight = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null);

/** The draft after adding, or changing the exam at `editing`. */
export function withExam(exams: readonly DraftExam[], exam: DraftExam, editing?: number): DraftExam[] {
  if (editing === undefined) return [...exams, exam];
  return exams.map((x, i) => (i === editing ? { ...exam, ...(x.id ? { id: x.id } : {}) } : x));
}

export const withoutExam = (exams: readonly DraftExam[], index: number): DraftExam[] => exams.filter((_, i) => i !== index);

export type SettingsProblem = "minimum" | "band" | null;

/** What is wrong with the settings, if anything. */
export function settingsProblem(s: Settings): SettingsProblem {
  if (wholePercent(s.theoryMin) === null || wholePercent(s.practicalMin) === null) return "minimum";
  if (s.graded && s.bands.some((b) => !b.grade.trim() || wholePercent(b.from) === null)) return "band";
  return null;
}

/** Whether the draft can be saved: it adds up to 100 and the settings are valid. */
export const canSave = (d: Draft): boolean => patternState(d.exams) === "complete" && settingsProblem(d.settings) === null;

/** The draft as the server takes it. Only call when `canSave` is true. */
export function toInput(d: Draft): ExamPatternInput {
  const s = d.settings;
  return {
    graded: s.graded,
    theoryMinPercent: wholePercent(s.theoryMin)!,
    practicalMinPercent: wholePercent(s.practicalMin)!,
    gradeBands: s.graded ? s.bands.map((b) => ({ grade: b.grade.trim(), from: wholePercent(b.from)! })) : null,
    terminals: d.exams.map((x) => ({ ...(x.id ? { id: x.id } : {}), name: x.name.trim(), weight: x.weight, hasPractical: x.hasPractical })),
  };
}

/** Whether the draft differs from what the server holds. */
export function isDirty(d: Draft, saved: ExamPattern): boolean {
  const base = draftFrom(saved);
  const settingsOf = (s: Settings) => JSON.stringify({ ...s, bands: s.graded ? s.bands : [] });
  const examsOf = (exams: readonly DraftExam[]) => JSON.stringify(exams.map((x) => ({ n: x.name.trim(), w: x.weight, p: x.hasPractical })));
  return examsOf(d.exams) !== examsOf(base.exams) || settingsOf(d.settings) !== settingsOf(base.settings);
}

export type Editable = { editable: true } | { editable: false; why: "locked" | "closed" | "notAllowed" };

/** Whether the pattern can change now, and if not, why: marks are in, the term is closed, or the person only looks. */
export function editability(saved: ExamPattern, canManage: boolean): Editable {
  if (saved.locked) return { editable: false, why: "locked" };
  if (saved.term.status === "closed") return { editable: false, why: "closed" };
  if (!canManage) return { editable: false, why: "notAllowed" };
  return { editable: true };
}
