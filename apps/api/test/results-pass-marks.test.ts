import { describe, expect, it } from "vitest";

import { finalResult, terminalResult, type Paper, type PatternRules, type SubjectPapers } from "../src/modules/results/grading";

/**
 * Pass marks per subject (the PM, 2026-10-11, for the first school). Written before the code (CLAUDE.md section 7).
 * When a school turns it on, each subject has its own pass marks in marks out of its paper, one for theory and one for
 * the practical. They are checked on every terminal (a terminal then says Pass or Fail) and on the final result (the
 * weighted marks of all terminals against the weighted pass marks). Without the switch nothing changes: a terminal
 * passes no one and the pattern's two percentages decide the final.
 */

const OFF: PatternRules = { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null };
const ON: PatternRules = { ...OFF, perSubject: true };
const GRADED_ON: PatternRules = { ...ON, graded: true, gradeBands: [{ grade: "A", from: 80 }, { grade: "B", from: 50 }, { grade: "C", from: 20 }] };

/** A paper out of `theoryMax` (+ `practicalMax`) with its pass marks, whole numbers (null mark: absent). */
const paper = (weight: number, theoryMax: number, theory: number | null, theoryPass: number | null, practical?: { max: number; value: number | null; pass: number | null }): Paper => ({
  terminalId: `t${weight}-${theoryMax}`,
  terminalName: `Terminal (${weight})`,
  weight,
  theory: { maxHundredths: theoryMax * 100, valueHundredths: theory === null ? null : theory * 100, absent: theory === null },
  practical: practical ? { maxHundredths: practical.max * 100, valueHundredths: practical.value === null ? null : practical.value * 100, absent: practical.value === null } : null,
  theoryPassHundredths: theoryPass === null ? null : theoryPass * 100,
  practicalPassHundredths: practical?.pass === undefined || practical.pass === null ? null : practical.pass * 100,
});
const subject = (name: string, ...papers: Paper[]): SubjectPapers => ({ offeringId: name, name, papers });

describe("a terminal, with pass marks per subject on", () => {
  it("passes a subject at its own pass mark and fails it one mark below: each subject has its own", () => {
    const result = terminalResult(ON, [
      subject("Maths", paper(30, 100, 32, 32)),
      subject("Art", paper(30, 50, 19, 20)),
    ]);
    expect(result.subjects.map((s) => s.passed)).toEqual([true, false]);
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("Fail");
  });

  it("passes the terminal when every subject reaches its mark, with the percentage still given", () => {
    const result = terminalResult(ON, [subject("Maths", paper(30, 100, 40, 32)), subject("Art", paper(30, 50, 20, 20))]);
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe("Pass");
    expect(result.percentHundredths).toBe(4000);
  });

  it("needs the practical to reach its own pass mark too", () => {
    const failsPractical = terminalResult(ON, [subject("Science", paper(30, 75, 60, 27, { max: 25, value: 7, pass: 8 }))]);
    expect(failsPractical.subjects[0]!.passed).toBe(false);
    const passes = terminalResult(ON, [subject("Science", paper(30, 75, 60, 27, { max: 25, value: 8, pass: 8 }))]);
    expect(passes.subjects[0]!.passed).toBe(true);
  });

  it("counts an absence as zero, so a subject with a pass mark fails", () => {
    expect(terminalResult(ON, [subject("Maths", paper(30, 100, null, 32))]).subjects[0]!.passed).toBe(false);
  });

  it("a subject with no pass mark set has no minimum", () => {
    expect(terminalResult(ON, [subject("Moral", paper(30, 100, 0, null))]).subjects[0]!.passed).toBe(true);
  });

  it("graded: a failed subject is NG, and so is the terminal; a passing one gets its letter", () => {
    const result = terminalResult(GRADED_ON, [subject("Maths", paper(30, 100, 90, 32)), subject("Art", paper(30, 50, 10, 20))]);
    expect(result.subjects.map((s) => s.grade)).toEqual(["A", "NG"]);
    expect(result.grade).toBe("NG");
    expect(result.outcome).toBe("NG");
  });
});

describe("a terminal, with the switch off: as before", () => {
  it("passes and fails no one, whatever the pass marks on the papers", () => {
    const result = terminalResult(OFF, [subject("Maths", paper(30, 100, 1, 32))]);
    expect(result.subjects[0]!.passed).toBeNull();
    expect(result.passed).toBeNull();
    expect(result.outcome).toBe("1.00%");
  });
});

describe("the final result, with pass marks per subject on", () => {
  const terminals = (first: number, second: number, pass = 32) => subject("Maths", paper(40, 100, first, pass), paper(60, 100, second, pass));

  it("weights the marks and the pass marks alike: 30 and 34 weigh to 32.4, the pass line is 32", () => {
    const result = finalResult(ON, [terminals(30, 34)]);
    expect(result.subjects[0]!.passed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe("Pass");
  });

  it("fails below the weighted pass line: 30 and 33 weigh to 31.8", () => {
    expect(finalResult(ON, [terminals(30, 33)]).subjects[0]!.passed).toBe(false);
  });

  it("uses each subject's own pass mark: Maths passes at 32 of 100 where Art needs 20 of 50", () => {
    const result = finalResult(ON, [terminals(33, 33), subject("Art", paper(40, 50, 19, 20), paper(60, 50, 19, 20))]);
    expect(result.subjects.map((s) => s.passed)).toEqual([true, false]);
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("Fail");
  });

  it("checks the practical on its own: theory far above its line does not cover a practical below its line", () => {
    const science = subject("Science", paper(100, 75, 70, 27, { max: 25, value: 7, pass: 8 }));
    expect(finalResult(ON, [science]).subjects[0]!.passed).toBe(false);
  });

  it("graded: a failed subject is NG and so is the overall", () => {
    const result = finalResult(GRADED_ON, [terminals(90, 90), subject("Art", paper(40, 50, 5, 20), paper(60, 50, 5, 20))]);
    expect(result.subjects.map((s) => s.grade)).toEqual(["A", "NG"]);
    expect(result.grade).toBe("NG");
  });

  it("with the switch off, the pattern's percentages decide and the papers' pass marks are ignored", () => {
    // 20 of 100 in both terminals is below the pattern's 35%, though the paper says 10 is enough.
    expect(finalResult(OFF, [terminals(20, 20, 10)]).subjects[0]!.passed).toBe(false);
    // 40 of 100 passes the pattern's 35%, though the paper says 50 is needed.
    expect(finalResult(OFF, [terminals(40, 40, 50)]).subjects[0]!.passed).toBe(true);
  });
});
