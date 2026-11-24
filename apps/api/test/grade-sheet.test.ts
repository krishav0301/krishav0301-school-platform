import { describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import { GradeSheetSchema, type GradeSheetConfig } from "../src/core/config/pack";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { bandFor, buildGradeSheet, buildLedger, percentOf, rankByRatio, type ClassCard } from "../src/modules/results/gradesheet";
import type { CardBody } from "../src/modules/results/schema";

/**
 * The grade-point marks card and the mark ledger (the PM, 2026-10-28, the first school's own paper documents). The
 * figures below are read off the school's real papers: the UKG card (7 subjects, 545 of 650, average 3.4, rank 18 of 26),
 * the Class 2 ledger (ties share a rank and the next follows: 7, 7, 8; the last two zero rows share 32).
 */

const lahan = parsePack(lahanJson).school.gradeSheet!;
const school = { name: "Lahan Manakamana Secondary English Boarding School", address: "Lahan Municipality-8, Siraha", contact: null, crest: null };

const part = (value: number, max: number) => ({ maxHundredths: max * 100, valueHundredths: value * 100, absent: false });
const subject = (name: string, got: number, full: number, passed: boolean | null = null) => ({
  offeringId: name.toLowerCase().replace(/\W/g, ""),
  name,
  theory: part(got, full),
  practical: null as { maxHundredths: number; valueHundredths: number | null; absent: boolean } | null,
  obtainedHundredths: got * 100,
  fullHundredths: full * 100,
  percentHundredths: percentOf(got * 100, full * 100),
  scaledHundredths: 0,
  grade: null,
  passed,
});
const card = (student: string, subjects: ReturnType<typeof subject>[]): CardBody => ({
  kind: "terminal",
  student: { name: student, sid: "2083-00001", rollNo: 1 },
  class: { programmeName: "School", levelName: "UKG", label: "A", sectionName: "School", yearLabel: "2083" },
  terminal: { name: "First Terminal Examination", weight: 100 },
  graded: false,
  subjects,
  percentHundredths: 0,
  grade: null,
  outcome: "",
});
const sheetCtx = (enrollmentId: string) => ({ school, cardId: "c", version: 1, enrollmentId, className: "UKG-A", dateOfBirthBs: null, rollNo: null, studentName: null, issuedOnBs: "2083/05/10" });

describe("the pack's grade sheet", () => {
  it("Lahan's file carries the printed scale, highest first, and no other school has one", () => {
    expect(lahan.scale.map((b) => [b.grade, b.from, b.pointHundredths])).toEqual([["A+", 90, 400], ["A", 80, 360], ["B+", 70, 320], ["B", 60, 280], ["C+", 50, 240], ["C", 40, 200], ["D+", 35, 160], ["NG", 0, 0]]);
    expect(lahan.rankStyle).toBe("dense");
  });

  it("gives a plain paper unless the file says otherwise, and takes only the two papers", () => {
    const base = { address: "x", scale: [{ grade: "A", from: 50, pointHundredths: 400, remark: "r" }, { grade: "B", from: 0, pointHundredths: 200, remark: "r" }] };
    expect(GradeSheetSchema.parse(base).paper).toBe("plain");
    expect(GradeSheetSchema.parse({ ...base, paper: "accent" }).paper).toBe("accent");
    expect(GradeSheetSchema.safeParse({ ...base, paper: "#ffd800" }).success).toBe(false);
    expect(lahan.paper).toBe("plain"); // white since the PM asked, 2026-11-24 (D-200)
  });

  it("refuses a scale that is out of order, repeats a grade, or does not reach 0", () => {
    const base = { address: "x", scale: [{ grade: "A", from: 50, pointHundredths: 400, remark: "r" }, { grade: "B", from: 0, pointHundredths: 200, remark: "r" }] };
    expect(GradeSheetSchema.safeParse(base).success).toBe(true);
    expect(GradeSheetSchema.safeParse({ ...base, scale: [base.scale[1], base.scale[0]] }).success).toBe(false);
    expect(GradeSheetSchema.safeParse({ ...base, scale: [base.scale[0], { ...base.scale[1], from: 5 }] }).success).toBe(false);
    expect(GradeSheetSchema.safeParse({ ...base, scale: [base.scale[0], { ...base.scale[1], grade: "a" }] }).success).toBe(false);
    expect(GradeSheetSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("the grade of a mark", () => {
  const at = (config: GradeSheetConfig, got: number, full: number) => bandFor(config, got, full).grade;

  it("Lahan's file grades as the shared cards award: a mark on a band's number stays in the band below (90 is A, 80 B+, 70 B, 40 D+), and 35 is below the lowest band", () => {
    expect([90, 80, 70, 60, 50, 40, 35].map((n) => at(lahan, n, 100))).toEqual(["A", "B+", "B", "C+", "C", "D+", "NG"]);
    expect([91, 81, 71, 61, 51, 41, 36, 0].map((n) => at(lahan, n, 100))).toEqual(["A+", "A", "B+", "B", "C+", "C", "D+", "NG"]);
  });

  it("every graded row of the shared cards comes out as printed on the card (26 rows from the UKG, Class 3 and Class 8 cards)", () => {
    const rows: [number, number, string, number][] = [
      [70, 100, "B", 280], [89, 100, "A", 360], [90, 100, "A", 360], [91, 100, "A+", 400], [35, 50, "B", 280], [75, 100, "B+", 320], [95, 100, "A+", 400],
      [89, 100, "A", 360], [71, 100, "B+", 320], [86, 100, "A", 360], [83, 100, "A", 360], [75, 100, "B+", 320], [41, 50, "A", 360], [41, 50, "A", 360],
      [40, 50, "B+", 320], [45, 50, "A", 360], [22, 50, "C", 200], [50, 50, "A+", 400], [36.5, 50, "B+", 320], [48, 50, "A+", 400], [20, 50, "D+", 160], [35, 50, "B", 280],
      [38.5, 50, "B+", 320], [20, 50, "D+", 160], [40, 50, "B+", 320], [37, 50, "B+", 320],
    ];
    for (const [got, full, grade, point] of rows) {
      const band = bandFor(lahan, Math.round(got * 100), full * 100);
      expect([band.grade, band.pointHundredths], `${got} of ${full}`).toEqual([grade, point]);
    }
  });

  it("the other reading is still there for a school whose cards grade by the printed table: a mark on a band's number is in that band", () => {
    const printed = { ...lahan, boundary: "from" as const };
    expect([90, 80, 70, 60, 50, 40].map((n) => at(printed, n, 100))).toEqual(["A+", "A", "B+", "B", "C+", "C"]);
    expect(at(printed, 35, 100)).toBe("D+");
    expect(at(printed, 34, 100)).toBe("NG");
  });

  it("works on a mark out of any full marks, with no rounding: 45 of 50 is exactly 90 per cent", () => {
    expect(at(lahan, 45, 50)).toBe("A");
    expect(at({ ...lahan, boundary: "from" }, 45, 50)).toBe("A+");
    expect(at(lahan, 4501, 5000)).toBe("A+");
  });
});

describe("ranks", () => {
  const rows = [["a", 602], ["b", 602], ["c", 599], ["d", 0], ["e", 0]].map(([id, obtained]) => ({ id: id as string, obtained: obtained as number, full: 800 }));

  it("dense: ties share a rank and the next one follows (7, 7, 8), as on the school's ledger", () => {
    const r = rankByRatio(rows, "dense");
    expect([...rows.map((x) => r.get(x.id))]).toEqual([1, 1, 2, 3, 3]);
  });

  it("competition: the next rank skips (1, 1, 3)", () => {
    const r = rankByRatio(rows, "competition");
    expect([...rows.map((x) => r.get(x.id))]).toEqual([1, 1, 3, 4, 4]);
  });

  it("compares by share of full marks, so a student with fewer papers is not ranked below on the total alone", () => {
    const r = rankByRatio([{ id: "x", obtained: 450, full: 500 }, { id: "y", obtained: 800, full: 1000 }], "dense");
    expect(r.get("x")).toBe(1);
    expect(r.get("y")).toBe(2);
  });
});

describe("equal marks ranked by attendance (D-196, the PM, 2026-11-23)", () => {
  const at = (working: number, present: number) => ({ workingDays: working, presentDays: present });
  const row = (id: string, obtained: number, attendance: { workingDays: number; presentDays: number } | null) => ({ id, obtained, full: 100, attendance });
  const ranks = (rows: ReturnType<typeof row>[], style: "dense" | "competition" = "dense") => {
    const r = rankByRatio(rows, style, "attendance");
    return rows.map((x) => r.get(x.id));
  };

  it("the better attendance goes ahead on equal marks, and the next rank follows (dense) or skips (competition)", () => {
    const rows = [row("a", 80, at(100, 80)), row("b", 80, at(100, 95)), row("c", 70, at(100, 100))];
    expect(ranks(rows)).toEqual([2, 1, 3]);
    expect(ranks(rows, "competition")).toEqual([2, 1, 3]);
  });

  it("marks always come first: full attendance never lifts lower marks", () => {
    expect(ranks([row("a", 81, at(100, 1)), row("b", 80, at(100, 100))])).toEqual([1, 2]);
  });

  it("compares attendance as a share of the working days, so 45 of 50 equals 90 of 100 and they still share", () => {
    expect(ranks([row("a", 80, at(50, 45)), row("b", 80, at(100, 90)), row("c", 60, null)])).toEqual([1, 1, 2]);
  });

  it("a student whose attendance was not given goes after one whose was; two with none share", () => {
    expect(ranks([row("a", 80, null), row("b", 80, at(100, 10)), row("c", 80, null), row("d", 50, null)])).toEqual([2, 1, 2, 3]);
  });

  it("is an order: same marks, one given and one not, and a third in between never loops", () => {
    // a ahead of c (both given), and both given ahead of b (none): one order, a, c, b.
    expect(ranks([row("a", 80, at(100, 90)), row("b", 80, null), row("c", 80, at(100, 80))])).toEqual([1, 3, 2]);
  });

  it("without the tie-break (another school), equal marks share whatever the attendance", () => {
    const r = rankByRatio([row("a", 80, at(100, 50)), row("b", 80, at(100, 100))], "dense");
    expect([r.get("a"), r.get("b")]).toEqual([1, 1]);
  });

  it("Lahan's school file turns it on; the format's default leaves it off", () => {
    expect(lahan.rankTieBreak).toBe("attendance");
    const { rankTieBreak, ...rest } = lahanJson.school.gradeSheet as Record<string, unknown>;
    expect(rankTieBreak).toBe("attendance");
    expect(parsePack({ ...lahanJson, school: { ...lahanJson.school, gradeSheet: rest } }).school.gradeSheet!.rankTieBreak).toBe("none");
  });
});

describe("the grade sheet of the UKG card", () => {
  // Nitesh Ram, UKG-A: English 70, Nepali 89, Science 90, Mathematics 91, Conversation 35 of 50, Hand writing 75, Social studies 95.
  const nitesh = card("Nitesh Ram", [subject("English", 70, 100), subject("Nepali", 89, 100), subject("Science", 90, 100), subject("Mathematics", 91, 100), subject("Conversation", 35, 50), subject("Hand writing", 75, 100), subject("Social studies", 95, 100)]);
  const classmates: ClassCard[] = [
    { enrollmentId: "n", body: nitesh },
    { enrollmentId: "o", body: card("Other", [subject("English", 99, 100), subject("Nepali", 80, 100), subject("Science", 40, 100), subject("Mathematics", 91, 100), subject("Conversation", 50, 50), subject("Hand writing", 60, 100), subject("Social studies", 20, 100)]) },
  ];
  const sheet = buildGradeSheet(lahan, sheetCtx("n"), nitesh, classmates);

  it("totals the full marks and the marks obtained, and the percentage is the total's (545 of 650 is 83.85)", () => {
    expect(sheet.totalFullHundredths).toBe(65_000);
    expect(sheet.totalObtainedHundredths).toBe(54_500);
    expect(sheet.percentHundredths).toBe(8385);
  });

  it("gives each subject its letter and grade point, and the highest grade point anyone in the class got", () => {
    const by = Object.fromEntries(sheet.subjects.map((s) => [s.name, s]));
    expect([by.English!.finalGrade, by.English!.pointHundredths]).toEqual(["B", 280]);
    expect([by.Science!.finalGrade, by.Science!.pointHundredths]).toEqual(["A", 360]);
    expect([by.Conversation!.finalGrade, by.Conversation!.pointHundredths]).toEqual(["B", 280]);
    expect(by.English!.highestPointHundredths).toBe(400); // the other student's 99
    expect(by.Mathematics!.highestPointHundredths).toBe(400);
  });

  it("averages the grade points to a tenth (the paper's 3.4), names the division, and ranks in the class", () => {
    expect(sheet.averagePointTenths).toBe(34);
    expect(sheet.division).toBe("Distinction");
    expect(sheet.classSize).toBe(2);
    expect(sheet.rank).toBe(1); // 545 of 650 against the other student's 440
  });

  it("prints the scale as the school's table: each band's range, point and remark", () => {
    expect(sheet.scale[0]).toEqual({ grade: "A+", from: 90, upTo: null, pointHundredths: 400, remark: "Outstanding" });
    expect(sheet.scale[7]).toMatchObject({ grade: "NG", from: 0, upTo: 35, pointHundredths: 0 });
  });

  it("divisions are \"this percentage and above\" (D-193): 80 is Distinction, 60 First, 50 Second, 40 Third, below 40 Fail, whatever the grade edges do", () => {
    const at = (percent: number) => {
      const c = card("d", [subject("a", percent * 100, 10_000)]);
      return buildGradeSheet(lahan, sheetCtx("d"), c, [{ enrollmentId: "d", body: c }]).division;
    };
    expect([100, 80, 79.99, 60, 59.99, 50, 49.99, 40].map(at)).toEqual(["Distinction", "Distinction", "First Division", "First Division", "Second Division", "Second Division", "Third Division", "Third Division"]);
    expect([39.99, 35, 0].map(at)).toEqual(["Fail", "Fail", "Fail"]);
  });

  it("the exam remark is the grade table's remark for the whole percentage, on the same edges as the overall grade (D-194)", () => {
    const at = (percent: number) => {
      const c = card("r", [subject("a", percent * 100, 10_000)]);
      const s = buildGradeSheet(lahan, sheetCtx("r"), c, [{ enrollmentId: "r", body: c }]);
      return [s.overallGrade, s.overallRemark];
    };
    expect(at(95)).toEqual(["A+", "Outstanding"]);
    expect(at(85)).toEqual(["A", "Excellent"]);
    expect(at(70.01)).toEqual(["B+", "Very Good"]);
    expect(at(70)).toEqual(["B", "Good"]); // exactly on a line stays in the band below, as Lahan's grades do
    expect(at(20)).toEqual(["NG", "Not Graded"]);
  });

  it("gives the division by the whole percentage even when a subject failed (D-193), and NG with a grade point of 0 to a subject that failed its own pass marks", () => {
    const failing = card("F", [subject("English", 90, 100), subject("Math", 60, 100, false)]);
    const s = buildGradeSheet(lahan, sheetCtx("f"), failing, [{ enrollmentId: "f", body: failing }]);
    expect(s.division).toBe("First Division"); // 150 of 200 is 75 per cent
    expect(s.subjects[1]).toMatchObject({ finalGrade: "NG", pointHundredths: 0 });
  });

  it("grades the theory and the practical of a paper on their own, and shows an absence", () => {
    const b = card("P", [{ ...subject("Science", 0, 100), theory: part(65, 75), practical: { maxHundredths: 2500, valueHundredths: null, absent: true }, obtainedHundredths: 6500, fullHundredths: 10_000 }]);
    const s = buildGradeSheet(lahan, sheetCtx("p"), b, [{ enrollmentId: "p", body: b }]).subjects[0]!;
    expect([s.theoryGrade, s.practicalGrade]).toEqual(["A", "NG"]);
    expect(s.practical!.absent).toBe(true);
  });
});

describe("the mark ledger", () => {
  const students = [["Ritik", 7, [66, 79, 64]], ["Pranish", 19, [66, 79, 64]], ["Shibani", 28, [80, 79, 63]], ["Suraj", 33, [0, 0, 0]], ["Jibika", 34, [0, 0, 0]]].map(([name, roll, marks]) => ({
    enrollmentId: name as string,
    name: name as string,
    rollNo: roll as number,
    body: card(name as string, ["Eng", "Nep", "Sci"].map((n, i) => subject(n, (marks as number[])[i]!, 100))),
  }));
  const subjects = [{ offeringId: "eng", name: "Eng", code: "Eng" }, { offeringId: "nep", name: "Nep", code: "Nep" }, { offeringId: "sci", name: "Sci", code: "Sci" }, { offeringId: "gk", name: "GK", code: "GK" }];
  const ledger = buildLedger(lahan, { classId: "c", school, yearLabel: "2082", className: "Two(B)", examName: null }, subjects, students);

  it("lists the subjects in the school's order and leaves out one nobody took", () => {
    expect(ledger.subjects.map((s) => s.code)).toEqual(["Eng", "Nep", "Sci"]);
  });

  it("has the marks, the total, the percentage and the rank, ties sharing a rank (the paper's 7, 7, 8 and 32, 32)", () => {
    expect(ledger.students.map((s) => [s.totalHundredths, s.rank])).toEqual([[20_900, 2], [20_900, 2], [22_200, 1], [0, 3], [0, 3]]);
    expect(ledger.students[2]!.percentHundredths).toBe(7400);
  });

  it("shows no mark for a subject a student does not take", () => {
    const partial = buildLedger(lahan, { classId: "c", school, yearLabel: "2082", className: "Two(B)", examName: null }, subjects, [
      students[0]!,
      { ...students[1]!, body: card("Pranish", [subject("Eng", 50, 100)]) },
    ]);
    expect(partial.subjects.every((x) => x.hasPractical === false)).toBe(true);
    expect(partial.students[1]!.marks).toEqual([{ valueHundredths: 5000, absent: false, theory: { valueHundredths: 5000, absent: false }, practical: null }, null, null]);
  });
});
