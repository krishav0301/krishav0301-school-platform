/**
 * The exam pattern's calculation (D-117; it replaces Phase 7's grading policies, D-079). Pure functions over whole
 * hundredths of a mark. Scaling is done in exact fractions (bigint) and rounded half up only at the end, so no
 * terminal's rounding ever moves a final across a boundary, and no float reaches a stored number.
 *
 * The PM's rules: one pattern per term, out of 100; each terminal has a weight and the weights add up to 100; a
 * teacher enters marks out of the paper (theory, plus practical where held), and the system scales the paper to the
 * terminal's weight. Pass or fail is decided on the final result only: theory and practical are added for the score,
 * but each must reach its minimum %, the practical counted only over the terminals that held it; the student must
 * pass every subject. Grade = No: the percentage and Pass / Fail. Grade = Yes: letters from the school's ranges; a
 * failed subject is NG and so is the overall. No credits and no GPA (OPEN: both may come later).
 * OPEN (stated default): an absence counts zero. The overall percentage is the average of the subjects' percentages.
 */

export interface GradeBand {
  grade: string;
  /** Whole percent: this letter from here up to the next band. */
  from: number;
}

export interface PatternRules {
  graded: boolean;
  theoryMinPercent: number;
  practicalMinPercent: number;
  /** Highest first, when graded; null otherwise. */
  gradeBands: GradeBand[] | null;
}

export interface PartMarks {
  maxHundredths: number;
  /** Null when absent (or, refused, when missing). */
  valueHundredths: number | null;
  absent: boolean;
}

/** One subject's paper in one terminal. */
export interface Paper {
  terminalId: string;
  terminalName: string;
  /** Whole percent of the final result. */
  weight: number;
  theory: PartMarks;
  /** Null when this terminal's paper has no practical. */
  practical: PartMarks | null;
}

export interface SubjectPapers {
  offeringId: string;
  name: string;
  papers: Paper[];
}

// --- Exact fractions -------------------------------------------------------------------------------------------

interface Frac {
  n: bigint;
  d: bigint;
}
const frac = (n: number | bigint, d: number | bigint = 1): Frac => ({ n: BigInt(n), d: BigInt(d) });
const add = (a: Frac, b: Frac): Frac => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const isZero = (a: Frac) => a.n === 0n;
/** a / b, both fractions, b not zero. */
const ratio = (a: Frac, b: Frac): Frac => ({ n: a.n * b.d, d: a.d * b.n });
/** The fraction (a share, 0 to 1) is at least `percent` %. */
const shareAtLeast = (a: Frac, percent: number): boolean => a.n * 100n >= BigInt(percent) * a.d;
/** The fraction (in percent) is at least `percent`. */
const percentAtLeast = (a: Frac, percent: number): boolean => a.n >= BigInt(percent) * a.d;
/** Whole hundredths, rounded half up (every value here is non-negative). */
const hundredths = (a: Frac, scale = 100n): number => Number((2n * a.n * scale + a.d) / (2n * a.d));

const letterFor = (bands: GradeBand[] | null, percent: Frac): string | null => bands?.find((b) => percentAtLeast(percent, b.from))?.grade ?? null;

function obtained(part: PartMarks, subject: string): number {
  if (part.absent) return 0;
  if (part.valueHundredths === null) throw new Error(`A mark is missing in ${subject}.`);
  return part.valueHundredths;
}

const fullOf = (p: Paper) => p.theory.maxHundredths + (p.practical?.maxHundredths ?? 0);

// --- One terminal ----------------------------------------------------------------------------------------------

export interface TerminalSubject {
  offeringId: string;
  name: string;
  theory: PartMarks;
  practical: PartMarks | null;
  obtainedHundredths: number;
  fullHundredths: number;
  percentHundredths: number;
  /** Out of the terminal's weight. */
  scaledHundredths: number;
  /** A letter when graded and at or above the lowest band; null otherwise. */
  grade: string | null;
  /** A terminal never passes or fails anyone: always null. */
  passed: null;
}

export interface TerminalResult {
  subjects: TerminalSubject[];
  percentHundredths: number;
  grade: string | null;
  passed: null;
  /** The headline: the letter when graded, else the percentage. */
  outcome: string;
}

/** One student's result in one terminal, for information only. Each subject has exactly one paper. */
export function terminalResult(rules: PatternRules, subjects: { offeringId: string; name: string; paper: Paper }[] | SubjectPapers[]): TerminalResult {
  if (subjects.length === 0) throw new Error("There are no subjects to grade.");
  let total = frac(0);
  const graded = subjects.map((s): TerminalSubject => {
    const p = "paper" in s ? s.paper : s.papers[0]!;
    const got = obtained(p.theory, s.name) + (p.practical ? obtained(p.practical, s.name) : 0);
    const full = fullOf(p);
    const percent = frac(got * 100, full);
    total = add(total, percent);
    return {
      offeringId: s.offeringId,
      name: s.name,
      theory: p.theory,
      practical: p.practical,
      obtainedHundredths: got,
      fullHundredths: full,
      percentHundredths: hundredths(percent),
      scaledHundredths: hundredths(frac(got * p.weight, full)),
      grade: rules.graded ? letterFor(rules.gradeBands, percent) : null,
      passed: null,
    };
  });
  const overall = ratio(total, frac(subjects.length));
  const percentHundredths = hundredths(overall);
  const grade = rules.graded ? letterFor(rules.gradeBands, overall) : null;
  return { subjects: graded, percentHundredths, grade, passed: null, outcome: grade ?? `${(percentHundredths / 100).toFixed(2)}%` };
}

// --- The final result ------------------------------------------------------------------------------------------

export interface FinalSubject {
  offeringId: string;
  name: string;
  terminals: { terminalId: string; terminalName: string; weight: number; obtainedHundredths: number; fullHundredths: number; scaledHundredths: number }[];
  /** Out of 100. */
  finalHundredths: number;
  theoryPercentHundredths: number;
  /** Null when no terminal held this subject's practical. */
  practicalPercentHundredths: number | null;
  passed: boolean;
  /** Graded: the letter, or NG when failed. Not graded: null. */
  grade: string | null;
}

export interface FinalResult {
  subjects: FinalSubject[];
  percentHundredths: number;
  passed: boolean;
  /** Graded: the overall letter, or NG. Not graded: null. */
  grade: string | null;
  /** The headline: the letter (or NG) when graded, else Pass or Fail. */
  outcome: string;
}

/** One student's final result over every terminal of the term. */
export function finalResult(rules: PatternRules, subjects: SubjectPapers[]): FinalResult {
  if (subjects.length === 0) throw new Error("There are no subjects to grade.");
  let total = frac(0);
  const graded = subjects.map((s): FinalSubject => {
    if (s.papers.length === 0) throw new Error(`${s.name} has no marks in any terminal.`);
    let final = frac(0);
    let theoryGot = frac(0);
    let theoryMax = frac(0);
    let practicalGot = frac(0);
    let practicalMax = frac(0);
    const terminals = s.papers.map((p) => {
      const full = fullOf(p);
      const t = obtained(p.theory, s.name);
      const pr = p.practical ? obtained(p.practical, s.name) : 0;
      const scaled = frac((t + pr) * p.weight, full);
      final = add(final, scaled);
      theoryGot = add(theoryGot, frac(t * p.weight, full));
      theoryMax = add(theoryMax, frac(p.theory.maxHundredths * p.weight, full));
      if (p.practical) {
        practicalGot = add(practicalGot, frac(pr * p.weight, full));
        practicalMax = add(practicalMax, frac(p.practical.maxHundredths * p.weight, full));
      }
      return { terminalId: p.terminalId, terminalName: p.terminalName, weight: p.weight, obtainedHundredths: t + pr, fullHundredths: full, scaledHundredths: hundredths(scaled) };
    });
    const theoryShare = ratio(theoryGot, theoryMax);
    const practicalShare = isZero(practicalMax) ? null : ratio(practicalGot, practicalMax);
    const passed = shareAtLeast(theoryShare, rules.theoryMinPercent) && (practicalShare === null || shareAtLeast(practicalShare, rules.practicalMinPercent));
    total = add(total, final);
    return {
      offeringId: s.offeringId,
      name: s.name,
      terminals,
      finalHundredths: hundredths(final),
      theoryPercentHundredths: hundredths(theoryShare, 10_000n),
      practicalPercentHundredths: practicalShare === null ? null : hundredths(practicalShare, 10_000n),
      passed,
      grade: rules.graded ? (passed ? (letterFor(rules.gradeBands, final) ?? "NG") : "NG") : null,
    };
  });
  const overall = ratio(total, frac(subjects.length));
  const passed = graded.every((s) => s.passed);
  const grade = rules.graded ? (passed ? (letterFor(rules.gradeBands, overall) ?? "NG") : "NG") : null;
  return { subjects: graded, percentHundredths: hundredths(overall), passed, grade, outcome: grade ?? (passed ? "Pass" : "Fail") };
}

/**
 * Ranks results, highest first. Ties share a rank and the next rank skips (1, 2, 2, 4): CLAUDE.md section 9's default,
 * "tied students share a rank". A result that did not pass is not ranked.
 */
export function rankResults<T extends { id: string; score: number; passed: boolean }>(results: T[]): { id: string; rank: number }[] {
  const sorted = results.filter((r) => r.passed).sort((a, b) => b.score - a.score);
  return sorted.map((r) => ({ id: r.id, rank: 1 + sorted.filter((o) => o.score > r.score).length }));
}

// --- The pattern's own rules -----------------------------------------------------------------------------------

/** What is wrong with a pattern, in words for the Co-ordinator, or null when it is sound. */
export function validatePattern(p: PatternRules & { terminals: { name: string; weight: number }[] }): string | null {
  if (p.terminals.length === 0) return "Add at least one terminal";
  if (p.terminals.length > 12) return "A term can have at most 12 terminals";
  const names = p.terminals.map((t) => t.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "A terminal name is used twice";
  if (p.terminals.some((t) => !Number.isInteger(t.weight) || t.weight < 1 || t.weight > 100)) return "Each terminal's weight is a whole number from 1 to 100";
  const sum = p.terminals.reduce((a, t) => a + t.weight, 0);
  if (sum !== 100) return `The terminals' weights must add up to 100 (they add up to ${sum})`;
  if (!p.graded) return p.gradeBands === null ? null : "Grade ranges are only for a grade system";
  const bands = p.gradeBands;
  if (!bands || bands.length === 0) return "A grade system needs its grade ranges";
  const letters = bands.map((b) => b.grade.trim().toLowerCase());
  if (new Set(letters).size !== letters.length) return "A grade is listed twice";
  for (let i = 1; i < bands.length; i++) if (bands[i]!.from >= bands[i - 1]!.from) return "List the grades highest first, each starting lower than the one above";
  const lowest = bands[bands.length - 1]!.from;
  if (lowest > Math.min(p.theoryMinPercent, p.practicalMinPercent)) return "The lowest grade must start at or below the pass minimums, so every pass gets a grade";
  return null;
}
