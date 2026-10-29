import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { bandFor, buildGradeSheet, buildLedger, percentOf, rankByRatio, type ClassCard } from "../src/modules/results/gradesheet";
import type { CardBody } from "../src/modules/results/schema";

/** Trying to break the grade sheet and the ledger: random marks, random classes, the edges of every band. */
const lahan = parsePack(lahanJson).school.gradeSheet!;
const school = { name: "S", address: "A", contact: null, crest: null };

const part = (value: number | null, max: number) => ({ maxHundredths: max, valueHundredths: value, absent: false });
const subject = (id: string, got: number, full: number, passed: boolean | null = null) => ({
  offeringId: id, name: id, theory: part(got, full), practical: null as ReturnType<typeof part> | null, obtainedHundredths: got, fullHundredths: full,
  percentHundredths: percentOf(got, full), scaledHundredths: 0, grade: null, passed,
});
const card = (name: string, subjects: ReturnType<typeof subject>[]): CardBody => ({
  kind: "terminal", student: { name, sid: name, rollNo: null }, class: { programmeName: "P", levelName: "L", label: "", sectionName: "S", yearLabel: "2083" },
  terminal: { name: "T", weight: 100 }, graded: false, subjects, percentHundredths: 0, grade: null, outcome: "",
});
const ctx = (id: string) => ({ school, cardId: "c", version: 1, enrollmentId: id, className: "C", dateOfBirthBs: null, rollNo: null, studentName: null, issuedOnBs: null });

const full = fc.integer({ min: 100, max: 20_000 }); // a paper out of 1 to 200 marks, in hundredths
const marksOf = (max: number) => fc.integer({ min: 0, max });

describe("the grade of a mark never goes down as the mark goes up", () => {
  for (const boundary of ["from", "above"] as const) {
    it(`boundary ${boundary}`, () => {
      const config = { ...lahan, boundary };
      fc.assert(
        fc.property(full, fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 20_000 }), (f, a, b) => {
          const [lo, hi] = [Math.min(a, b, f), Math.min(Math.max(a, b), f)];
          expect(bandFor(config, hi, f).pointHundredths).toBeGreaterThanOrEqual(bandFor(config, lo, f).pointHundredths);
        }),
        { numRuns: 2000 },
      );
    });
  }

  it("the full mark is the top grade, nothing is the lowest, whatever the paper is out of", () => {
    fc.assert(fc.property(full, (f) => {
      expect(bandFor(lahan, f, f).grade).toBe("A+");
      expect(bandFor(lahan, 0, f).grade).toBe("NG");
    }));
  });

  it("'above' never gives a better grade than 'from' for the same mark", () => {
    fc.assert(fc.property(full, marksOf(20_000), (f, m) => {
      const got = Math.min(m, f);
      expect(bandFor({ ...lahan, boundary: "above" }, got, f).pointHundredths).toBeLessThanOrEqual(bandFor({ ...lahan, boundary: "from" }, got, f).pointHundredths);
    }), { numRuns: 2000 });
  });

  it("every band edge, on every paper size, falls where the setting says", () => {
    for (const f of [100, 500, 2500, 3750, 5000, 7500, 10_000, 15_000]) {
      for (const band of lahan.scale.slice(0, -1)) {
        const edge = (band.from * f) / 100; // the mark exactly on the band's number, when it is whole hundredths
        if (!Number.isInteger(edge)) continue;
        expect(bandFor({ ...lahan, boundary: "from" }, edge, f).grade).toBe(band.grade);
        expect(bandFor({ ...lahan, boundary: "above" }, edge, f).grade).not.toBe(band.grade);
        expect(bandFor({ ...lahan, boundary: "above" }, edge + 1, f).grade).toBe(band.grade);
      }
    }
  });
});

describe("ranks", () => {
  const rows = fc.array(fc.record({ obtained: fc.integer({ min: 0, max: 100_000 }), full: fc.integer({ min: 1, max: 100_000 }) }), { minLength: 1, maxLength: 60 }).map((a) => a.map((r, i) => ({ id: `s${i}`, obtained: Math.min(r.obtained, r.full), full: r.full })));

  it("a better result never ranks below a worse one, equal results share a rank, and rank 1 always exists", () => {
    fc.assert(
      fc.property(rows, fc.constantFrom("dense" as const, "competition" as const), (list, style) => {
        const r = rankByRatio(list, style);
        expect(r.size).toBe(list.length);
        expect(Math.min(...r.values())).toBe(1);
        for (const a of list) for (const b of list) {
          const ra = r.get(a.id)!, rb = r.get(b.id)!;
          if (a.obtained * b.full > b.obtained * a.full) expect(ra).toBeLessThan(rb);
          if (a.obtained * b.full === b.obtained * a.full) expect(ra).toBe(rb);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("dense ranks have no gaps; competition ranks equal one plus the number strictly better", () => {
    fc.assert(
      fc.property(rows, (list) => {
        const dense = [...new Set(rankByRatio(list, "dense").values())].sort((a, b) => a - b);
        expect(dense).toEqual(dense.map((_, i) => i + 1));
        const comp = rankByRatio(list, "competition");
        for (const a of list) expect(comp.get(a.id)).toBe(1 + list.filter((b) => b.obtained * a.full > a.obtained * b.full).length);
      }),
      { numRuns: 300 },
    );
  });
});

describe("a whole class", () => {
  const cls = fc.array(fc.array(marksOf(100), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 25 });

  it("keeps every figure in range: percentage 0 to 100, average point 0 to 4, highest never below the student's own, rank 1 to the class size", () => {
    fc.assert(
      fc.property(cls, (students) => {
        const width = Math.min(...students.map((m) => m.length));
        const cards: ClassCard[] = students.map((m, i) => ({ enrollmentId: `e${i}`, body: card(`s${i}`, m.slice(0, width).map((got, j) => subject(`sub${j}`, got * 100, 10_000))) }));
        for (const c of cards) {
          const s = buildGradeSheet(lahan, ctx(c.enrollmentId), c.body, cards);
          expect(s.percentHundredths).toBeGreaterThanOrEqual(0);
          expect(s.percentHundredths).toBeLessThanOrEqual(10_000);
          expect(s.averagePointTenths).toBeGreaterThanOrEqual(0);
          expect(s.averagePointTenths).toBeLessThanOrEqual(40);
          expect(s.rank).toBeGreaterThanOrEqual(1);
          expect(s.rank).toBeLessThanOrEqual(s.classSize);
          expect(s.classSize).toBe(cards.length);
          for (const l of s.subjects) expect(l.highestPointHundredths).toBeGreaterThanOrEqual(l.pointHundredths);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("the ledger and the grade sheet give a student the same rank and the same total", () => {
    fc.assert(
      fc.property(cls, (students) => {
        const width = Math.min(...students.map((m) => m.length));
        const cards = students.map((m, i) => ({ enrollmentId: `e${i}`, name: `s${i}`, rollNo: i + 1, body: card(`s${i}`, m.slice(0, width).map((got, j) => subject(`sub${j}`, got * 100, 10_000))) }));
        const subjects = Array.from({ length: width }, (_, j) => ({ offeringId: `sub${j}`, name: `sub${j}`, code: null }));
        const ledger = buildLedger(lahan, { classId: "c", school, yearLabel: "2083", className: "C", examName: null }, subjects, cards);
        for (const l of ledger.students) {
          const c = cards.find((x) => x.enrollmentId === l.enrollmentId)!;
          const s = buildGradeSheet(lahan, ctx(c.enrollmentId), c.body, cards);
          expect(l.rank).toBe(s.rank);
          expect(l.totalHundredths).toBe(s.totalObtainedHundredths);
          expect(l.percentHundredths).toBe(s.percentHundredths);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("odd cards", () => {
  it("a class of one is rank 1 of 1", () => {
    const c = card("only", [subject("a", 5000, 10_000)]);
    const s = buildGradeSheet(lahan, ctx("e"), c, [{ enrollmentId: "e", body: c }]);
    expect([s.rank, s.classSize]).toEqual([1, 1]);
  });

  it("a card with no subjects does not crash or claim a division", () => {
    const c = card("empty", []);
    const s = buildGradeSheet(lahan, ctx("e"), c, [{ enrollmentId: "e", body: c }]);
    expect(s.division).toBeNull();
    expect(s.percentHundredths).toBe(0);
  });

  it("a subject with no full marks is the lowest grade, not the highest", () => {
    expect(bandFor(lahan, 0, 0).grade).toBe("NG");
  });

  it("a student marked absent in everything is NG in every subject, with no division", () => {
    const absent = { maxHundredths: 10_000, valueHundredths: null, absent: true };
    const c = card("away", [{ ...subject("a", 0, 10_000), theory: absent }, { ...subject("b", 0, 10_000), theory: absent }]);
    const s = buildGradeSheet(lahan, ctx("e"), c, [{ enrollmentId: "e", body: c }]);
    expect(s.subjects.map((x) => x.finalGrade)).toEqual(["NG", "NG"]);
    expect(s.division).toBeNull();
    expect(s.averagePointTenths).toBe(0);
  });

  it("the same holds with the plain 'from' reading: nothing out of nothing is the top grade, and an empty card has no division", () => {
    const plain = { ...lahan, boundary: "from" as const };
    expect(bandFor(plain, 0, 0).grade).toBe("NG");
    const c = card("empty", []);
    const s = buildGradeSheet(plain, ctx("e"), c, [{ enrollmentId: "e", body: c }]);
    expect(s.division).toBeNull();
    expect(s.overallGrade).toBe("NG");
  });

  it("marks above the full mark (which entry refuses) still cannot exceed the top grade", () => {
    expect(bandFor(lahan, 20_000, 10_000).grade).toBe("A+");
  });
});
