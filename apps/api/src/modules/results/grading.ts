/**
 * Grading policies (an extension point, CLAUDE.md section 2: "grading, ranking and tie-break"). A programme names its
 * policy; a class whose programme names none cannot be published (CLAUDE.md section 6). Pure functions over whole
 * hundredths of a mark: no floats reach a stored number.
 *
 * OPEN: every scale here is a stated default until the client confirms it (build plan, Phase 7 needs).
 *  - `neb_gpa` (+2): the widely republished NEB scale, UNVERIFIED against the official directive (D-079, D-085: the
 *    bands and minimums match the secondary sources; a Letter Grading Directive 2083 is reported to replace 2078, and
 *    how theory and internal combine into a subject's grade is still to be checked). A subject is graded on its combined marks, each component weighted by its
 *    maximum; it is NG when theory is below 35% or a practical or internal component below 40%, or when any component
 *    was missed. The GPA is the credit-hour-weighted mean of the subject grade points, two decimals, half up, and no
 *    total. A result with any NG subject has no GPA.
 *  - `percentage_division` (Bachelor's placeholder and the sample school): one percentage over every subject's marks;
 *    every subject must reach 32%; Distinction 80, First 60, Second 45, Third 32.
 */

export type GradingPolicy = "neb_gpa" | "percentage_division";
export const GRADING_POLICIES = ["neb_gpa", "percentage_division"] as const satisfies readonly GradingPolicy[];

export type ComponentKind = "theory" | "practical";

export interface ComponentMarks {
  /** The component's public id, when known (a recheck corrects marks by it). */
  id?: string;
  name: string;
  kind: ComponentKind;
  maxHundredths: number;
  /** Null when not entered; an absence is `absent`, never a zero. */
  valueHundredths: number | null;
  absent: boolean;
}

export interface SubjectMarks {
  offeringId: string;
  name: string;
  creditHundredths: number | null;
  components: ComponentMarks[];
}

export interface SubjectResult {
  offeringId: string;
  name: string;
  creditHundredths: number | null;
  obtainedHundredths: number;
  maxHundredths: number;
  percentHundredths: number;
  /** A letter (NEB) or Pass / Fail (percentage). */
  grade: string;
  gradePointHundredths: number | null;
  passed: boolean;
}

export interface GradedResult {
  policy: GradingPolicy;
  subjects: SubjectResult[];
  gpaHundredths: number | null;
  percentHundredths: number | null;
  /** The headline: a GPA's "NG" or the division ("Distinction", "First", …, "Fail"). For NEB with a GPA, "GPA". */
  outcome: string;
  passed: boolean;
}

/** a / b rounded half up, for non-negative whole numbers. */
const divRound = (a: number, b: number): number => Math.floor((2 * a + b) / (2 * b));

/** NEB's letters, highest first: at or above `from` percent. OPEN: unverified. */
const NEB_SCALE: { from: number; grade: string; point: number }[] = [
  { from: 90, grade: "A+", point: 400 },
  { from: 80, grade: "A", point: 360 },
  { from: 70, grade: "B+", point: 320 },
  { from: 60, grade: "B", point: 280 },
  { from: 50, grade: "C+", point: 240 },
  { from: 40, grade: "C", point: 200 },
  { from: 35, grade: "D", point: 160 },
];
const NEB_THEORY_MIN = 35;
const NEB_PRACTICAL_MIN = 40;

/** OPEN: placeholders until each programme's real rule is known. */
const PASS_PERCENT = 32;
const DIVISIONS: { from: number; name: string }[] = [
  { from: 80, name: "Distinction" },
  { from: 60, name: "First" },
  { from: 45, name: "Second" },
  { from: 32, name: "Third" },
];

/** `obtained / max` is at least `percent` %, exactly. */
const atLeast = (obtained: number, max: number, percent: number): boolean => obtained * 100 >= percent * max;

function totals(subject: SubjectMarks): { obtained: number; max: number; absent: boolean } {
  let obtained = 0;
  let max = 0;
  let absent = false;
  for (const c of subject.components) {
    if (c.absent) absent = true;
    else if (c.valueHundredths === null) throw new Error(`A mark is missing in ${subject.name} (${c.name}).`);
    obtained += c.absent ? 0 : c.valueHundredths!;
    max += c.maxHundredths;
  }
  if (max === 0) throw new Error(`${subject.name} has no mark components.`);
  return { obtained, max, absent };
}

function nebSubject(subject: SubjectMarks): SubjectResult {
  if (subject.creditHundredths === null) throw new Error(`${subject.name} has no credit hours, which an NEB GPA needs.`);
  const { obtained, max, absent } = totals(subject);
  const componentFails = subject.components.some(
    (c) => !c.absent && !atLeast(c.valueHundredths!, c.maxHundredths, c.kind === "theory" ? NEB_THEORY_MIN : NEB_PRACTICAL_MIN),
  );
  const band = absent || componentFails ? undefined : NEB_SCALE.find((b) => atLeast(obtained, max, b.from));
  return {
    offeringId: subject.offeringId,
    name: subject.name,
    creditHundredths: subject.creditHundredths,
    obtainedHundredths: obtained,
    maxHundredths: max,
    percentHundredths: divRound(obtained * 10_000, max),
    grade: band?.grade ?? "NG",
    gradePointHundredths: band?.point ?? 0,
    passed: band !== undefined,
  };
}

function percentageSubject(subject: SubjectMarks): SubjectResult {
  const { obtained, max, absent } = totals(subject);
  const passed = !absent && atLeast(obtained, max, PASS_PERCENT);
  return {
    offeringId: subject.offeringId,
    name: subject.name,
    creditHundredths: subject.creditHundredths,
    obtainedHundredths: obtained,
    maxHundredths: max,
    percentHundredths: divRound(obtained * 10_000, max),
    grade: passed ? "Pass" : "Fail",
    gradePointHundredths: null,
    passed,
  };
}

/** Grades one student's marks for one terminal under a policy. Throws if a mark is missing or the setup is incomplete. */
export function gradeResult(policy: GradingPolicy, subjects: SubjectMarks[]): GradedResult {
  if (subjects.length === 0) throw new Error("There are no subjects to grade.");
  if (policy === "neb_gpa") {
    const graded = subjects.map(nebSubject);
    const passed = graded.every((s) => s.passed);
    const credits = graded.reduce((sum, s) => sum + s.creditHundredths!, 0);
    const points = graded.reduce((sum, s) => sum + s.gradePointHundredths! * s.creditHundredths!, 0);
    return {
      policy,
      subjects: graded,
      gpaHundredths: passed ? divRound(points, credits) : null,
      percentHundredths: null,
      outcome: passed ? "GPA" : "NG",
      passed,
    };
  }
  const graded = subjects.map(percentageSubject);
  const obtained = graded.reduce((sum, s) => sum + s.obtainedHundredths, 0);
  const max = graded.reduce((sum, s) => sum + s.maxHundredths, 0);
  const passed = graded.every((s) => s.passed);
  const division = passed ? DIVISIONS.find((d) => atLeast(obtained, max, d.from)) : undefined;
  return {
    policy,
    subjects: graded,
    gpaHundredths: null,
    percentHundredths: divRound(obtained * 10_000, max),
    outcome: division?.name ?? "Fail",
    passed: division !== undefined,
  };
}

/** The number a result is ranked by: its GPA or its percentage. */
export const rankScore = (r: { gpaHundredths: number | null; percentHundredths: number | null }): number => r.gpaHundredths ?? r.percentHundredths ?? 0;

/**
 * Ranks results, highest first. Ties share a rank and the next rank skips (1, 2, 2, 4): CLAUDE.md section 9's default,
 * "tied students share a rank" (OPEN: the NEB tie-break is the client's to confirm). A result that did not pass is not ranked.
 */
export function rankResults<T extends { id: string; score: number; passed: boolean }>(results: T[]): { id: string; rank: number }[] {
  const sorted = results.filter((r) => r.passed).sort((a, b) => b.score - a.score);
  return sorted.map((r) => ({ id: r.id, rank: 1 + sorted.filter((o) => o.score > r.score).length }));
}
