import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { finalResult, rankResults, terminalResult, validatePattern, type Paper, type PatternRules, type SubjectPapers } from "../src/modules/results/grading";

/**
 * The exam pattern's calculation (D-117). Written before the code (CLAUDE.md section 7: tests before code for grading).
 * The rules, all the PM's: one pattern per term, out of 100; terminals with weights adding up to 100; teachers enter
 * marks out of the paper, scaled to the terminal's weight; theory and practical added for the score, but each must
 * reach its minimum, the practical counting only the terminals that held it; pass or fail on the final result only;
 * every subject must pass; Grade = No: percentage and Pass / Fail; Grade = Yes: letters from the ranges, a failed
 * subject NG and the overall NG. No credits and no GPA.
 */

const BANDS = [
  { grade: "A+", from: 90 },
  { grade: "A", from: 80 },
  { grade: "B+", from: 70 },
  { grade: "B", from: 60 },
  { grade: "C+", from: 50 },
  { grade: "C", from: 40 },
  { grade: "D", from: 35 },
];
const PERCENT: PatternRules = { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null };
const GRADED: PatternRules = { ...PERCENT, graded: true, gradeBands: BANDS };

/** A paper out of `theoryMax` (+ `practicalMax`), marks in whole numbers (null: absent). */
const paper = (weight: number, theoryMax: number, theory: number | null, practicalMax?: number, practical?: number | null): Paper => ({
  terminalId: `t${weight}-${theoryMax}`,
  terminalName: `Terminal (${weight})`,
  weight,
  theory: { maxHundredths: theoryMax * 100, valueHundredths: theory === null ? null : Math.round(theory * 100), absent: theory === null },
  practical:
    practicalMax === undefined
      ? null
      : { maxHundredths: practicalMax * 100, valueHundredths: practical === null || practical === undefined ? null : Math.round(practical * 100), absent: practical === null },
});
const subject = (name: string, ...papers: Paper[]): SubjectPapers => ({ offeringId: name, name, papers });

describe("one terminal: scaled to its weight, for information only", () => {
  it("scales the paper's marks to the terminal's weight: 67 of 100 in a 30-weight terminal is 20.10", () => {
    const result = terminalResult(PERCENT, [subject("English", paper(30, 100, 67))]);
    expect(result.subjects[0]).toMatchObject({ obtainedHundredths: 6700, fullHundredths: 10000, percentHundredths: 6700, scaledHundredths: 2010 });
    expect(result.percentHundredths).toBe(6700);
  });

  it("adds theory and practical before scaling: 60 + 20 of 75 + 25 is 80 of 100", () => {
    const result = terminalResult(PERCENT, [subject("Physics", paper(30, 75, 60, 25, 20))]);
    expect(result.subjects[0]).toMatchObject({ obtainedHundredths: 8000, fullHundredths: 10000, percentHundredths: 8000, scaledHundredths: 2400 });
  });

  it("works for a paper that is not out of 100: 50 of 75 in a 30-weight terminal is 20.00", () => {
    const result = terminalResult(PERCENT, [subject("Art", paper(30, 75, 50))]);
    expect(result.subjects[0]).toMatchObject({ percentHundredths: 6667, scaledHundredths: 2000 });
  });

  it("counts an absence as zero", () => {
    const result = terminalResult(PERCENT, [subject("Physics", paper(40, 75, 60, 25, null))]);
    expect(result.subjects[0]).toMatchObject({ obtainedHundredths: 6000, percentHundredths: 6000 });
  });

  it("never says pass or fail", () => {
    const result = terminalResult(GRADED, [subject("English", paper(30, 100, 5))]);
    expect(result.passed).toBeNull();
    expect(result.subjects[0]!.passed).toBeNull();
  });

  it("shows letters when graded, nothing below the lowest band, and none at all for a percentage pattern", () => {
    const graded = terminalResult(GRADED, [subject("English", paper(30, 100, 91)), subject("Nepali", paper(30, 100, 20))]);
    expect(graded.subjects.map((s) => s.grade)).toEqual(["A+", null]);
    expect(graded.grade).toBe("C+"); // (91 + 20) / 2 = 55.50
    expect(terminalResult(PERCENT, [subject("English", paper(30, 100, 91))]).subjects[0]!.grade).toBeNull();
  });

  it("the overall percentage is the average of the subjects' percentages", () => {
    const result = terminalResult(PERCENT, [subject("A", paper(30, 100, 70)), subject("B", paper(30, 50, 45)), subject("C", paper(30, 100, 33))]);
    // 70, 90 and 33: 193 / 3 = 64.333… → 64.33
    expect(result.percentHundredths).toBe(6433);
  });

  it("refuses a missing mark", () => {
    const missing: Paper = { ...paper(30, 100, 50), theory: { maxHundredths: 10000, valueHundredths: null, absent: false } };
    expect(() => terminalResult(PERCENT, [subject("English", missing)])).toThrow(/missing/i);
  });
});

describe("the final result: every terminal, out of 100, pass or fail", () => {
  it("adds the scaled terminals: 67, 80 and 72 over 30 / 30 / 40 is 72.90", () => {
    const result = finalResult(PERCENT, [subject("English", paper(30, 100, 67), paper(30, 100, 80), paper(40, 100, 72))]);
    expect(result.subjects[0]).toMatchObject({ finalHundredths: 7290, passed: true });
    expect(result.subjects[0]!.terminals.map((t) => t.scaledHundredths)).toEqual([2010, 2400, 2880]);
    expect(result).toMatchObject({ percentHundredths: 7290, passed: true, outcome: "Pass", grade: null });
  });

  it("rounds only at the end, never per terminal", () => {
    // 1 of 3 in every terminal: 10 + 10 + 13.333… = 33.33.
    const third = (w: number) => paper(w, 3, 1);
    const result = finalResult({ ...PERCENT, theoryMinPercent: 0 }, [subject("X", third(30), third(30), third(40))]);
    expect(result.subjects[0]!.finalHundredths).toBe(3333);
    const tiny = finalResult({ ...PERCENT, theoryMinPercent: 0 }, [subject("Y", paper(30, 300, 1), paper(30, 300, 1), paper(40, 300, 1))]);
    // 0.1 + 0.1 + 0.1333… = 0.3333… → 0.33 (rounding each first would give 0.10 + 0.10 + 0.13 = 0.33 too, so check another)
    expect(tiny.subjects[0]!.finalHundredths).toBe(33);
    const sum = finalResult({ ...PERCENT, theoryMinPercent: 0 }, [subject("Z", paper(50, 300, 1), paper(50, 300, 1))]);
    // 0.1666… + 0.1666… = 0.3333… → 0.33; rounded per terminal it would be 0.17 + 0.17 = 0.34
    expect(sum.subjects[0]!.finalHundredths).toBe(33);
  });

  it("checks theory and practical each against its minimum, over the whole term", () => {
    // Theory 70/75 every time (93%), practical 5/25 (20%): a total of 75%, but the practical fails.
    const result = finalResult(PERCENT, [subject("Physics", paper(30, 75, 70, 25, 5), paper(30, 75, 70, 25, 5), paper(40, 75, 70, 25, 5))]);
    expect(result.subjects[0]).toMatchObject({ finalHundredths: 7500, practicalPercentHundredths: 2000, passed: false });
    expect(result).toMatchObject({ passed: false, outcome: "Fail" });
  });

  it("counts the practical only in the terminals that held it", () => {
    // Terminal 1 theory only (100), terminals 2 and 3 with practical 25. The practical's share is 7.5 + 10 = 17.5.
    const physics = subject("Physics", paper(30, 100, 60), paper(30, 75, 45, 25, 10), paper(40, 75, 45, 25, 10));
    const result = finalResult(PERCENT, [physics]);
    expect(result.subjects[0]!.practicalPercentHundredths).toBe(4000);
    // Theory: 18 + 13.5 + 18 = 49.5 of 30 + 22.5 + 30 = 82.5 → 60%
    expect(result.subjects[0]!.theoryPercentHundredths).toBe(6000);
    expect(result.subjects[0]!.passed).toBe(true);
  });

  it("has no practical check for a subject that never held one", () => {
    const result = finalResult(PERCENT, [subject("English", paper(50, 100, 40), paper(50, 100, 40))]);
    expect(result.subjects[0]).toMatchObject({ practicalPercentHundredths: null, passed: true });
  });

  it("passes exactly at the minimum and fails just below it", () => {
    expect(finalResult(PERCENT, [subject("E", paper(100, 100, 35))]).passed).toBe(true);
    expect(finalResult(PERCENT, [subject("E", paper(100, 100, 34.99))]).passed).toBe(false);
    expect(finalResult(PERCENT, [subject("P", paper(100, 75, 75, 25, 10))]).passed).toBe(true);
    expect(finalResult(PERCENT, [subject("P", paper(100, 75, 75, 25, 9.99))]).passed).toBe(false);
  });

  it("a weak terminal never fails anyone on its own", () => {
    const result = finalResult(PERCENT, [subject("English", paper(30, 100, 10), paper(30, 100, 60), paper(40, 100, 60))]);
    // 3 + 18 + 24 = 45: passed
    expect(result).toMatchObject({ percentHundredths: 4500, passed: true });
  });

  it("the student must pass every subject", () => {
    const result = finalResult(PERCENT, [subject("A", paper(100, 100, 95)), subject("B", paper(100, 100, 95)), subject("C", paper(100, 100, 20))]);
    expect(result.subjects.map((s) => s.passed)).toEqual([true, true, false]);
    expect(result).toMatchObject({ passed: false, outcome: "Fail" });
  });

  it("counts an absence as zero", () => {
    const result = finalResult(PERCENT, [subject("English", paper(50, 100, null), paper(50, 100, 90))]);
    expect(result.subjects[0]).toMatchObject({ finalHundredths: 4500, passed: true });
  });

  it("the overall percentage is the average of the subjects' finals", () => {
    const result = finalResult(PERCENT, [subject("A", paper(100, 100, 70)), subject("B", paper(100, 50, 45)), subject("C", paper(100, 100, 41))]);
    // 70 + 90 + 41 = 201 / 3 = 67.00
    expect(result.percentHundredths).toBe(6700);
  });
});

describe("the final result when graded", () => {
  it("gives each subject and the overall a letter from the ranges, at each boundary", () => {
    const cases: [number, string][] = [[100, "A+"], [90, "A+"], [89.99, "A"], [80, "A"], [70, "B+"], [60, "B"], [50, "C+"], [40, "C"], [35, "D"]];
    for (const [percent, letter] of cases) {
      const result = finalResult(GRADED, [subject("English", paper(100, 100, percent))]);
      expect(result.subjects[0]!.grade).toBe(letter);
      expect(result).toMatchObject({ grade: letter, outcome: letter, passed: true });
    }
  });

  it("a failed subject is NG, and then the overall is NG", () => {
    const result = finalResult(GRADED, [subject("English", paper(100, 100, 95)), subject("Physics", paper(100, 75, 75, 25, 5))]);
    expect(result.subjects.map((s) => s.grade)).toEqual(["A+", "NG"]);
    expect(result).toMatchObject({ grade: "NG", outcome: "NG", passed: false });
  });

  it("the overall letter follows the overall percentage", () => {
    const result = finalResult(GRADED, [subject("A", paper(100, 100, 95)), subject("B", paper(100, 100, 75))]);
    expect(result).toMatchObject({ percentHundredths: 8500, grade: "A", outcome: "A" });
  });
});

describe("ranking", () => {
  it("ties share a rank and the next skips; a fail is not ranked", () => {
    const ranked = rankResults([
      { id: "a", score: 9000, passed: true },
      { id: "b", score: 8000, passed: true },
      { id: "c", score: 8000, passed: true },
      { id: "d", score: 7000, passed: true },
      { id: "e", score: 9900, passed: false },
    ]);
    expect(ranked).toEqual([
      { id: "a", rank: 1 },
      { id: "b", rank: 2 },
      { id: "c", rank: 2 },
      { id: "d", rank: 4 },
    ]);
  });
});

describe("the pattern's own rules", () => {
  const ok = { ...GRADED, terminals: [{ name: "Terminal 1", weight: 30 }, { name: "Terminal 2", weight: 30 }, { name: "Terminal 3", weight: 40 }] };

  it("accepts a sound pattern", () => {
    expect(validatePattern(ok)).toBeNull();
    expect(validatePattern({ ...PERCENT, terminals: [{ name: "Final", weight: 100 }] })).toBeNull();
  });

  it("needs the weights to add up to 100", () => {
    expect(validatePattern({ ...ok, terminals: [{ name: "A", weight: 30 }, { name: "B", weight: 30 }] })).toMatch(/add up to 100/);
  });

  it("needs at least one terminal, at most 12, with different names", () => {
    expect(validatePattern({ ...ok, terminals: [] })).toMatch(/at least one/i);
    expect(validatePattern({ ...ok, terminals: Array.from({ length: 13 }, (_, i) => ({ name: `T${i}`, weight: i === 0 ? 88 : 1 })) })).toMatch(/12/);
    expect(validatePattern({ ...ok, terminals: [{ name: "Final", weight: 50 }, { name: "final", weight: 50 }] })).toMatch(/twice/);
  });

  it("needs grade ranges only when graded, highest first, each letter once", () => {
    expect(validatePattern({ ...ok, gradeBands: null })).toMatch(/grade/i);
    expect(validatePattern({ ...ok, graded: false, gradeBands: BANDS })).toMatch(/grade/i);
    expect(validatePattern({ ...ok, gradeBands: [{ grade: "A", from: 80 }, { grade: "A+", from: 90 }, { grade: "D", from: 35 }] })).toMatch(/highest first/i);
    expect(validatePattern({ ...ok, gradeBands: [{ grade: "A", from: 80 }, { grade: "a", from: 35 }] })).toMatch(/twice/);
  });

  it("needs the lowest grade to start at or below the pass minimums, so every pass gets a letter", () => {
    expect(validatePattern({ ...ok, gradeBands: [{ grade: "A", from: 80 }, { grade: "B", from: 50 }] })).toMatch(/lowest grade/i);
  });
});

describe("properties", () => {
  const arbPaper = fc
    .record({ theoryMax: fc.integer({ min: 1, max: 200 }), practicalMax: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }), t: fc.double({ min: 0, max: 1, noNaN: true }), p: fc.double({ min: 0, max: 1, noNaN: true }) })
    .map((r) => ({ ...r, theory: Math.floor(r.theoryMax * r.t * 100) / 100, practical: r.practicalMax === undefined ? undefined : Math.floor(r.practicalMax * r.p * 100) / 100 }));
  const arbWeights = fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 6 }).map((raw) => {
    const total = raw.reduce((a, b) => a + b, 0);
    const weights = raw.map((r) => Math.max(1, Math.floor((r * 100) / total)));
    weights[0]! += 100 - weights.reduce((a, b) => a + b, 0);
    return weights.filter((w) => w > 0);
  });

  it("a final is between 0 and 100, never above the sum of the weights, and full marks give exactly 100", () => {
    fc.assert(
      fc.property(arbWeights, fc.array(arbPaper, { minLength: 6, maxLength: 6 }), (weights, papers) => {
        if (weights.some((w) => w <= 0) || weights.reduce((a, b) => a + b, 0) !== 100) return;
        const s = subject("S", ...weights.map((w, i) => paper(w, papers[i]!.theoryMax, papers[i]!.theory, papers[i]!.practicalMax, papers[i]!.practical)));
        const result = finalResult({ ...PERCENT, theoryMinPercent: 0, practicalMinPercent: 0 }, [s]);
        expect(result.subjects[0]!.finalHundredths).toBeGreaterThanOrEqual(0);
        expect(result.subjects[0]!.finalHundredths).toBeLessThanOrEqual(10000);
        const full = subject("F", ...weights.map((w, i) => paper(w, papers[i]!.theoryMax, papers[i]!.theoryMax, papers[i]!.practicalMax, papers[i]!.practicalMax)));
        expect(finalResult(PERCENT, [full]).subjects[0]!.finalHundredths).toBe(10000);
      }),
    );
  });

  it("more marks never lower a final", () => {
    fc.assert(
      fc.property(arbPaper, fc.integer({ min: 1, max: 100 }), (p, bump) => {
        const base = finalResult(PERCENT, [subject("S", paper(100, p.theoryMax, p.theory))]).subjects[0]!.finalHundredths;
        const more = Math.min(p.theoryMax, p.theory + bump / 100);
        expect(finalResult(PERCENT, [subject("S", paper(100, p.theoryMax, more))]).subjects[0]!.finalHundredths).toBeGreaterThanOrEqual(base);
      }),
    );
  });

  it("a rank is one more than the number strictly ahead", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ score: fc.integer({ min: 0, max: 10000 }), passed: fc.boolean() }), { maxLength: 30 }), (rows) => {
        const items = rows.map((r, i) => ({ id: String(i), ...r }));
        for (const { id, rank } of rankResults(items)) {
          const me = items[Number(id)]!;
          expect(rank).toBe(1 + items.filter((o) => o.passed && o.score > me.score).length);
        }
      }),
    );
  });
});
