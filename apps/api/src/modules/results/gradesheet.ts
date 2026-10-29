import type { GradeSheetConfig } from "../../core/config/pack";
import type { CardBody, GradeSheet, MarkLedger } from "./schema";

/**
 * The grade-point marks card and the mark ledger (the PM, 2026-10-28, the first school's own paper documents). Pure
 * functions over a stored card snapshot and the school's scale. A card's marks are whole hundredths; a percentage is
 * compared with a band by cross-multiplying (no rounding decides a grade), and rounded half up only to be shown.
 *
 * OPEN: a subject whose card says it failed its own pass marks shows NG and a grade point of 0, as the card's letter does.
 * A division is "this percentage and above" (80 is Distinction), whatever the grade edges do; the PM confirmed the four cut-offs
 * (2026-10-29). A student who failed a subject gets none.
 * OPEN: the average grade point is the plain mean of the subjects' points, to a tenth, as the paper's cards add up.
 */

export interface SubjectFigures {
  offeringId: string;
  name: string;
  fullHundredths: number;
  obtainedHundredths: number;
  theory: { maxHundredths: number; valueHundredths: number | null; absent: boolean } | null;
  practical: { maxHundredths: number; valueHundredths: number | null; absent: boolean } | null;
  /** False only when the card says the subject failed its pass marks. */
  passed: boolean;
}

/** A card's subjects as plain figures: a terminal card has the paper's marks; a final has each subject out of 100. */
export function figuresOf(body: CardBody): SubjectFigures[] {
  if (body.kind === "terminal") {
    return body.subjects.map((s) => ({ offeringId: s.offeringId, name: s.name, fullHundredths: s.fullHundredths, obtainedHundredths: s.obtainedHundredths, theory: s.theory, practical: s.practical, passed: s.passed !== false }));
  }
  return body.subjects.map((s) => ({ offeringId: s.offeringId, name: s.name, fullHundredths: 10_000, obtainedHundredths: s.finalHundredths, theory: null, practical: null, passed: s.passed }));
}

/** Whole hundredths of a percent, rounded half up: obtained over full. */
export const percentOf = (obtained: number, full: number): number => (full <= 0 ? 0 : Math.floor((2 * obtained * 10_000 + full) / (2 * full)));

type Band = GradeSheetConfig["scale"][number];

/** Whether obtained / full reaches a whole percent `from`: at it (`from`), or only above it (`above`). Exact, by cross-multiplying. */
export const reaches = (boundary: GradeSheetConfig["boundary"], obtained: number, full: number, from: number): boolean => {
  // Nothing out of nothing reaches nothing: a paper with no full marks must not come out as the top grade.
  if (full <= 0) return false;
  return boundary === "above" ? obtained * 100 > from * full : obtained * 100 >= from * full;
};

/** The first band (highest first) that obtained / full reaches. The last band starts at 0, so there is always one. */
export const bandFor = (config: GradeSheetConfig, obtained: number, full: number): Band => config.scale.find((b) => reaches(config.boundary, obtained, full, b.from)) ?? lowest(config.scale);

/** The letter of a part of a paper, or null when there is no such part (or it is blank). An absence is the lowest band. */
function partGrade(config: GradeSheetConfig, part: SubjectFigures["theory"]): string | null {
  if (!part || part.maxHundredths <= 0) return null;
  return bandFor(config, part.absent ? 0 : (part.valueHundredths ?? 0), part.maxHundredths).grade;
}

const lowest = (scale: Band[]): Band => scale[scale.length - 1]!;

/** One subject's letter and grade point. A subject that failed its own pass marks is the lowest band (NG, 0). */
export function subjectPoint(config: GradeSheetConfig, s: SubjectFigures): Band {
  return s.passed ? bandFor(config, s.obtainedHundredths, s.fullHundredths) : lowest(config.scale);
}

/** Ranks by a ratio, highest first. Ties share a rank; `dense` then continues with the next number, `competition` skips. */
export function rankByRatio<T extends { id: string; obtained: number; full: number }>(rows: T[], style: "dense" | "competition"): Map<string, number> {
  const greater = (a: T, b: T) => a.obtained * b.full > b.obtained * a.full;
  const same = (a: T, b: T) => a.obtained * b.full === b.obtained * a.full;
  const sorted = [...rows].sort((a, b) => (greater(a, b) ? -1 : greater(b, a) ? 1 : 0));
  const ranks = new Map<string, number>();
  let rank = 0;
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    if (!prev || !same(prev, row)) rank = style === "dense" ? rank + 1 : i + 1;
    ranks.set(row.id, rank);
  });
  return ranks;
}

const totals = (subjects: SubjectFigures[]) => ({ obtained: subjects.reduce((a, s) => a + s.obtainedHundredths, 0), full: subjects.reduce((a, s) => a + s.fullHundredths, 0) });

export interface ClassCard {
  enrollmentId: string;
  body: CardBody;
}

/** The highest grade point in each subject over the class's cards. */
export function highestPoints(config: GradeSheetConfig, cards: ClassCard[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const card of cards) for (const s of figuresOf(card.body)) best.set(s.offeringId, Math.max(best.get(s.offeringId) ?? 0, subjectPoint(config, s).pointHundredths));
  return best;
}

export interface SheetContext {
  school: GradeSheet["school"];
  cardId: string;
  version: number;
  enrollmentId: string;
  className: string;
  dateOfBirthBs: string | null;
  /** The student's name now, as the record spells it (a correction after publishing shows; marks stay as published). */
  studentName: string | null;
  /** The student's roll number now (roll numbers are given after the class is made, so a card published earlier still shows it). */
  rollNo: number | null;
  issuedOnBs: string | null;
}

/** The grade-point marks card of one card, among the class's latest cards. */
export function buildGradeSheet(config: GradeSheetConfig, ctx: SheetContext, body: CardBody, classCards: ClassCard[]): GradeSheet {
  const subjects = figuresOf(body);
  const highest = highestPoints(config, classCards);
  const lines = subjects.map((s) => {
    const band = subjectPoint(config, s);
    return {
      offeringId: s.offeringId,
      name: s.name,
      fullHundredths: s.fullHundredths,
      theory: s.theory,
      practical: s.practical,
      obtainedHundredths: s.obtainedHundredths,
      theoryGrade: partGrade(config, s.theory),
      practicalGrade: partGrade(config, s.practical),
      finalGrade: band.grade,
      pointHundredths: band.pointHundredths,
      highestPointHundredths: highest.get(s.offeringId) ?? band.pointHundredths,
    };
  });
  const { obtained, full } = totals(subjects);
  const failed = lines.some((l, i) => !subjects[i]!.passed || l.finalGrade === lowest(config.scale).grade);
  const percentHundredths = percentOf(obtained, full);
  const division = failed ? null : (config.divisions.find((d) => reaches("from", obtained, full, d.from))?.name ?? null);
  const pointSum = lines.reduce((a, l) => a + l.pointHundredths, 0);
  const ranked = rankByRatio(
    classCards.map((c) => ({ id: c.enrollmentId, ...totalsOf(c.body) })),
    config.rankStyle,
  );
  return {
    cardId: ctx.cardId,
    version: ctx.version,
    school: ctx.school,
    examName: body.kind === "terminal" ? body.terminal.name : null,
    yearLabel: body.class.yearLabel,
    student: { name: ctx.studentName ?? body.student.name, sid: body.student.sid, rollNo: ctx.rollNo ?? body.student.rollNo, dateOfBirthBs: ctx.dateOfBirthBs },
    className: ctx.className,
    subjects: lines,
    totalFullHundredths: full,
    totalObtainedHundredths: obtained,
    percentHundredths,
    division,
    overallGrade: bandFor(config, obtained, full).grade,
    averagePointTenths: lines.length === 0 ? 0 : Math.floor((2 * pointSum + 10 * lines.length) / (20 * lines.length)),
    rank: ranked.get(ctx.enrollmentId) ?? classCards.length,
    classSize: classCards.length,
    issuedOnBs: ctx.issuedOnBs,
    paper: config.paper,
    scale: config.scale.map((b, i) => ({ grade: b.grade, from: b.from, upTo: i === 0 ? null : config.scale[i - 1]!.from, pointHundredths: b.pointHundredths, remark: b.remark })),
  };
}

const totalsOf = (body: CardBody) => {
  const t = totals(figuresOf(body));
  return { obtained: t.obtained, full: t.full };
};

export interface LedgerStudent extends ClassCard {
  name: string;
  rollNo: number | null;
}

/** The mark ledger of a class's published cards, subjects in the given order (the class's own setup order). */
export function buildLedger(
  config: GradeSheetConfig,
  head: { classId: string; school: MarkLedger["school"]; yearLabel: string; className: string; examName: string | null },
  subjects: MarkLedger["subjects"],
  cards: LedgerStudent[],
): MarkLedger {
  const figures = cards.map((c) => ({ card: c, subjects: figuresOf(c.body), ...totalsOf(c.body) }));
  const ranks = rankByRatio(
    figures.map((f) => ({ id: f.card.enrollmentId, obtained: f.obtained, full: f.full })),
    config.rankStyle,
  );
  // Only subjects some card has are columns, so a subject nobody took never appears.
  const present = subjects.filter((s) => figures.some((f) => f.subjects.some((x) => x.offeringId === s.offeringId)));
  return {
    classId: head.classId,
    school: head.school,
    yearLabel: head.yearLabel,
    className: head.className,
    examName: head.examName,
    subjects: present,
    students: figures.map((f) => ({
      enrollmentId: f.card.enrollmentId,
      rollNo: f.card.rollNo,
      name: f.card.name,
      marks: present.map((s) => {
        const got = f.subjects.find((x) => x.offeringId === s.offeringId);
        if (!got) return null;
        const absent = got.theory !== null && got.theory.absent && (got.practical === null || got.practical.absent);
        return { valueHundredths: got.obtainedHundredths, absent };
      }),
      totalHundredths: f.obtained,
      percentHundredths: percentOf(f.obtained, f.full),
      rank: ranks.get(f.card.enrollmentId) ?? cards.length,
    })),
  };
}
