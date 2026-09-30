import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { gradeResult, rankResults, type SubjectMarks } from "../src/modules/results/grading";

/**
 * Grading policies (Phase 7, slice 1, D-079). Written before the code (CLAUDE.md section 7: tests before code for
 * grading). The rules are CLAUDE.md section 6, "Marks and results": a per-programme grading policy; +2 follows NEB,
 * subject-wise letter grades and a credit-hour-weighted GPA, no total. The NEB scale below is UNVERIFIED (neb.gov.np
 * could not be reached from this environment); it is the widely republished scale, marked OPEN in the code.
 */

const component = (kind: "theory" | "practical", max: number, value: number | null, absent = false) => ({ name: kind, kind, maxHundredths: max * 100, valueHundredths: value === null ? null : Math.round(value * 100), absent });
const subject = (name: string, credit: number | null, ...components: ReturnType<typeof component>[]): SubjectMarks => ({ offeringId: name, name, creditHundredths: credit === null ? null : credit * 100, components });

describe("NEB letter grades and GPA (UNVERIFIED scale, OPEN)", () => {
  it("maps a subject's percentage to the letter and grade point at each boundary", () => {
    const cases: [number, string, number][] = [
      [100, "A+", 400], [90, "A+", 400], [89.99, "A", 360], [80, "A", 360], [70, "B+", 320], [60, "B", 280],
      [50, "C+", 240], [40, "C", 200], [35, "D", 160], [34.99, "NG", 0], [0, "NG", 0],
    ];
    for (const [percent, letter, point] of cases) {
      const result = gradeResult("neb_gpa", [subject("English", 4, component("theory", 100, percent))]);
      expect(result.subjects[0]).toMatchObject({ grade: letter, gradePointHundredths: point });
    }
  });

  it("grades a subject on its combined marks, weighted by each component's maximum", () => {
    // Theory 60/75 (80%) and practical 25/25 (100%): 85 of 100, an A.
    const result = gradeResult("neb_gpa", [subject("Physics", 5, component("theory", 75, 60), component("practical", 25, 25))]);
    expect(result.subjects[0]).toMatchObject({ grade: "A", gradePointHundredths: 360, percentHundredths: 8500 });
  });

  it("is NG when theory is below 35% or practical below 40%, whatever the total", () => {
    const lowTheory = gradeResult("neb_gpa", [subject("Physics", 5, component("theory", 75, 26), component("practical", 25, 25))]); // 34.67% theory
    expect(lowTheory.subjects[0]!.grade).toBe("NG");
    const lowPractical = gradeResult("neb_gpa", [subject("Physics", 5, component("theory", 75, 75), component("practical", 25, 9.75))]); // 39%
    expect(lowPractical.subjects[0]!.grade).toBe("NG");
    const justEnough = gradeResult("neb_gpa", [subject("Physics", 5, component("theory", 75, 26.25), component("practical", 25, 10))]);
    expect(justEnough.subjects[0]!.grade).not.toBe("NG");
  });

  it("is NG for a subject with an absence in any component", () => {
    const result = gradeResult("neb_gpa", [subject("Physics", 5, component("theory", 75, 70), component("practical", 25, null, true))]);
    expect(result.subjects[0]!.grade).toBe("NG");
    expect(result.passed).toBe(false);
  });

  it("GPA is the credit-hour-weighted mean of the subjects' grade points, to two decimals, with no total", () => {
    // A+ (4.0) x 4 credits and B (2.8) x 1 credit: (16 + 2.8) / 5 = 3.76.
    const result = gradeResult("neb_gpa", [subject("English", 4, component("theory", 100, 95)), subject("Nepali", 1, component("theory", 100, 65))]);
    expect(result.gpaHundredths).toBe(376);
    expect(result.percentHundredths).toBeNull();
    expect(result.passed).toBe(true);
    // Three subjects whose mean is not exact: (4.0 + 3.6 + 3.6) / 3 = 3.7333… → 3.73.
    const thirds = gradeResult("neb_gpa", [1, 2, 3].map((n) => subject(`S${n}`, 3, component("theory", 100, n === 1 ? 95 : 85))));
    expect(thirds.gpaHundredths).toBe(373);
  });

  it("gives no GPA when any subject is NG: the result is not graded", () => {
    const result = gradeResult("neb_gpa", [subject("English", 4, component("theory", 100, 95)), subject("Nepali", 3, component("theory", 100, 20))]);
    expect(result.gpaHundredths).toBeNull();
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("NG");
  });

  it("refuses to grade a subject without credit hours: the GPA would be meaningless", () => {
    expect(() => gradeResult("neb_gpa", [subject("English", null, component("theory", 100, 80))])).toThrow(/credit hours/);
  });
});

describe("percentage and division (placeholder, OPEN)", () => {
  it("adds every subject into one percentage and names the division", () => {
    const cases: [number, string][] = [[80, "Distinction"], [79.99, "First"], [60, "First"], [45, "Second"], [32, "Third"]];
    for (const [percent, division] of cases) {
      const result = gradeResult("percentage_division", [subject("English", null, component("theory", 100, percent)), subject("Maths", null, component("theory", 100, percent))]);
      expect(result).toMatchObject({ outcome: division, passed: true, percentHundredths: Math.round(percent * 100), gpaHundredths: null });
    }
  });

  it("fails the whole result when any subject is below the pass mark, or absent", () => {
    const low = gradeResult("percentage_division", [subject("English", null, component("theory", 100, 90)), subject("Maths", null, component("theory", 100, 31.99))]);
    expect(low).toMatchObject({ outcome: "Fail", passed: false });
    expect(low.subjects[1]).toMatchObject({ grade: "Fail" });
    const absent = gradeResult("percentage_division", [subject("English", null, component("theory", 100, null, true))]);
    expect(absent.passed).toBe(false);
  });

  it("weights subjects by their maximum marks, not equally", () => {
    // 45/50 (90%) and 32/100 (32%): equal weights would give 61%; by marks it is 77 of 150.
    const result = gradeResult("percentage_division", [subject("Art", null, component("theory", 50, 45)), subject("Maths", null, component("theory", 100, 32))]);
    expect(result.percentHundredths).toBe(5133); // 77 of 150 = 51.33%
  });
});

describe("any grading", () => {
  it("refuses a missing mark: a result is graded only when every mark is entered or marked absent", () => {
    expect(() => gradeResult("neb_gpa", [subject("English", 4, component("theory", 100, null))])).toThrow(/missing/);
  });

  it("uses whole numbers only, and never grades above the top or below zero", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ max: fc.integer({ min: 1, max: 200 }), got: fc.integer({ min: 0, max: 20000 }), credit: fc.integer({ min: 1, max: 6 }) }), { minLength: 1, maxLength: 8 }),
        fc.constantFrom("neb_gpa" as const, "percentage_division" as const),
        (rows, policy) => {
          const subjects = rows.map((r, i) => ({
            offeringId: `s${i}`,
            name: `S${i}`,
            creditHundredths: r.credit * 100,
            components: [{ name: "Theory", kind: "theory" as const, maxHundredths: r.max * 100, valueHundredths: Math.min(r.got, r.max * 100), absent: false }],
          }));
          const result = gradeResult(policy, subjects);
          for (const n of [result.gpaHundredths, result.percentHundredths, ...result.subjects.map((s) => s.percentHundredths)]) {
            if (n !== null) expect(Number.isInteger(n)).toBe(true);
          }
          if (result.gpaHundredths !== null) expect(result.gpaHundredths).toBeGreaterThanOrEqual(160);
          if (result.gpaHundredths !== null) expect(result.gpaHundredths).toBeLessThanOrEqual(400);
          if (result.percentHundredths !== null) expect(result.percentHundredths).toBeLessThanOrEqual(10000);
        },
      ),
    );
  });
});

describe("ranking", () => {
  it("ties share a rank and the next rank skips (1, 2, 2, 4); a result that did not pass is not ranked", () => {
    const ranked = rankResults([
      { id: "a", score: 376, passed: true },
      { id: "b", score: 400, passed: true },
      { id: "c", score: 376, passed: true },
      { id: "d", score: 300, passed: true },
      { id: "e", score: 390, passed: false },
    ]);
    expect(ranked).toEqual([
      { id: "b", rank: 1 },
      { id: "a", rank: 2 },
      { id: "c", rank: 2 },
      { id: "d", rank: 4 },
    ]);
  });

  it("for any scores, a rank is one more than the number of people strictly ahead", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 40 }), (scores) => {
        const ranked = rankResults(scores.map((score, i) => ({ id: String(i), score, passed: true })));
        for (const r of ranked) expect(r.rank).toBe(1 + scores.filter((s) => s > scores[Number(r.id)]!).length);
      }),
    );
  });
});
