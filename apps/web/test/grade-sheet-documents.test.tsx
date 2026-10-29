import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GradeSheetDocument, partCell, rangeText } from "@/results/GradeSheetDocument";
import { MarkLedgerDocument, columnName, markCell } from "@/results/MarkLedgerDocument";
import { notForYou } from "@/results/client";
import { fileSafe, fitOnA4, planSheets } from "@/results/download-pdf";
import { pointTableText, pointText, tenthsText, type GradeSheet, type MarkLedger } from "@/results/model";

/**
 * The grade-point marks card and the mark ledger as the school prints them (the PM, 2026-10-28). The fixtures are read off
 * the school's own papers (the UKG card; the Class 2 ledger).
 */

const school = { name: "Lahan Manakamana Secondary English Boarding School", address: "Lahan Municipality-8, Siraha", contact: "Contact No: 9814753921", crest: "lahan/crest.webp" };
const scale: GradeSheet["scale"] = [
  { grade: "A+", from: 90, upTo: null, pointHundredths: 400, remark: "Outstanding" },
  { grade: "A", from: 80, upTo: 90, pointHundredths: 360, remark: "Excellent" },
  { grade: "D", from: 35, upTo: 40, pointHundredths: 140, remark: "Partially Acceptable" },
  { grade: "NG", from: 0, upTo: 35, pointHundredths: 0, remark: "Not Graded" },
];
const sheet: GradeSheet = {
  cardId: "c1",
  version: 1,
  school,
  examName: "First Terminal Examination",
  yearLabel: "2083",
  student: { name: "Nitesh Ram", sid: "2083-00015", rollNo: 15, dateOfBirthBs: null },
  className: "UKG-A",
  subjects: [
    { offeringId: "e", name: "English", fullHundredths: 10_000, theory: { maxHundredths: 7500, valueHundredths: 6500, absent: false }, practical: { maxHundredths: 2500, valueHundredths: null, absent: true }, obtainedHundredths: 6500, theoryGrade: "A", practicalGrade: "NG", finalGrade: "B", pointHundredths: 280, highestPointHundredths: 400 },
    { offeringId: "n", name: "Nepali", fullHundredths: 10_000, theory: { maxHundredths: 10_000, valueHundredths: 8900, absent: false }, practical: null, obtainedHundredths: 8900, theoryGrade: "A", practicalGrade: null, finalGrade: "A", pointHundredths: 360, highestPointHundredths: 400 },
  ],
  totalFullHundredths: 20_000,
  totalObtainedHundredths: 15_400,
  percentHundredths: 7700,
  division: "First Division",
  overallGrade: "B+",
  averagePointTenths: 32,
  rank: 18,
  classSize: 26,
  issuedOnBs: "2083/05/10",
  paper: "accent",
  scale,
};

describe("the grade-sheet", () => {
  const html = renderToStaticMarkup(<GradeSheetDocument sheet={sheet} />);

  it("has the school's head: crest, name, address, the GRADE-SHEET title and the exam in its box", () => {
    expect(html).toContain('src="/site/lahan/crest.webp"');
    expect(html).toContain("Lahan Manakamana Secondary English Boarding School");
    expect(html).toContain("Lahan Municipality-8, Siraha");
    expect(html).toContain("GRADE-SHEET");
    expect(html).toContain("First Terminal Examination - 2083");
  });

  it("names the student, the class, the registration and roll numbers", () => {
    expect(html).toContain("Nitesh Ram");
    expect(html).toContain("UKG-A");
    expect(html).toContain("2083-00015");
    expect(html).toContain(">15<");
  });

  it("lists each subject with its marks, letters, grade point and the class's highest", () => {
    expect(html).toContain("English");
    expect(html).toContain(">65.00<");
    expect(html).toContain(">AB<");
    expect(html).toContain(">3.6<");
    expect(html).toContain(">4.0<");
    expect(html).toContain(">200.00<"); // the total of the full marks, to two places as on the paper
  });

  it("gives the percentage, division, average grade point and rank as x/y, and leaves attendance and remarks empty for the hand", () => {
    expect(html).toContain("77.00");
    expect(html).toContain("First Division");
    expect(html).toContain("3.2");
    expect(html).toContain("18/26");
    expect(html).toContain("2083/05/10");
    expect(html).toMatch(/Attendance<\/th>/);
    expect(html).toMatch(/<td class="[^"]*blank[^"]*"><\/td>/);
    expect(html).toMatch(/Exam remarks/);
  });

  it("prints the grade table as the school's, with every range, point and remark, then the empty Other activities table and the three signatures", () => {
    expect(html).toContain("90 to 100");
    expect(html).toContain("80 to below 90");
    expect(html).toContain("Below 35");
    expect(html).toContain("1.40");
    expect(html).toContain("Partially Acceptable");
    expect(html).toContain("Other activities");
    expect(html).toContain("Guardian signature");
    expect(html).toContain("Class teacher");
    expect(html).toContain("Principal");
  });

  it("is headed by a final result's name when it has no exam, and has no crest image when the school gave none", () => {
    const final = renderToStaticMarkup(<GradeSheetDocument sheet={{ ...sheet, examName: null, school: { ...school, crest: null } }} />);
    expect(final).toContain("Final Result - 2083");
    expect(final).not.toContain("<img");
  });

  it("is on the school's yellow paper when its file says so, and on the plain surface otherwise", () => {
    expect(html).toMatch(/class="sheet paper"/);
    expect(renderToStaticMarkup(<GradeSheetDocument sheet={{ ...sheet, paper: "plain" }} />)).not.toMatch(/paper"/);
  });

  it("formats grade points and ranges as the paper does", () => {
    expect([pointText(360), pointText(400), pointTableText(140), tenthsText(34)]).toEqual(["3.6", "4.0", "1.40", "3.4"]);
    expect(rangeText(scale[0]!)).toBe("90 to 100");
    expect(rangeText(scale[3]!)).toBe("Below 35");
    expect(partCell(null)).toBe("");
  });
});

const ledger: MarkLedger = {
  classId: "k",
  school,
  yearLabel: "2082",
  className: "Two(B)",
  examName: null,
  subjects: [
    { offeringId: "eng", name: "English", code: "Eng" },
    { offeringId: "gk", name: "General Knowledge", code: null },
  ],
  students: [
    { enrollmentId: "a", rollNo: 1, name: "Aadarsh Mandal", marks: [{ valueHundredths: 4100, absent: false }, null], totalHundredths: 4100, percentHundredths: 4100, rank: 29 },
    { enrollmentId: "b", rollNo: 2, name: "Aadarsh Yadav", marks: [{ valueHundredths: 0, absent: true }, { valueHundredths: 3800, absent: false }], totalHundredths: 3800, percentHundredths: 3800, rank: 30 },
  ],
};

describe("the mark ledger", () => {
  const html = renderToStaticMarkup(<MarkLedgerDocument ledger={ledger} />);

  it("has the school's head with its contact line, the Mark Ledger title, the year, class and exam", () => {
    expect(html).toContain("Contact No: 9814753921");
    expect(html).toContain("Mark Ledger");
    expect(html).toContain("2082");
    expect(html).toContain("Two(B)");
    expect(html).toContain("Annual Examination");
  });

  it("heads each column with the subject's short name, or its name when it has none", () => {
    expect(columnName(ledger.subjects[0]!)).toBe("Eng");
    expect(columnName(ledger.subjects[1]!)).toBe("General Knowledge");
    expect(html).toContain(">Eng<");
  });

  it("has every student's roll number, name, marks to two places, total, percentage and rank", () => {
    expect(html).toContain("Aadarsh Mandal");
    expect(html).toContain(">41.00<");
    expect(html).toContain(">29<");
    expect(markCell(null)).toBe("");
    expect(markCell({ valueHundredths: 0, absent: true })).toBe("AB");
  });

  it("ends with Prepared by, Checked by and Approved by", () => {
    for (const word of ["Prepared by", "Checked by", "Approved by"]) expect(html).toContain(word);
  });
});

describe("the PDF download", () => {
  it("fills the whole sheet when the page has the sheet's shape", () => {
    const at = fitOnA4(2100, 2970);
    expect(at.x).toBeCloseTo(0, 5);
    expect(at.y).toBe(0);
    expect(at.width).toBeCloseTo(210, 5);
    expect(at.height).toBeCloseTo(297, 5);
  });

  it("names the file from letters and digits only", () => {
    expect(fileSafe("Apsara Singh", "First Terminal Examination", "2083")).toBe("Apsara-Singh-First-Terminal-Examination-2083");
    expect(fileSafe("  ", "")).toBe("document");
    expect(fileSafe("राम", "x/y")).toBe("x-y");
  });

  it("puts the page as large as fits on A4, inside its margins and centred, never off the page", () => {
    for (const [w, h] of [[800, 1100], [1000, 3000], [3000, 800]] as const) {
      const at = fitOnA4(w, h);
      // A thousandth of a millimetre of slack for floating-point rounding.
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + at.width).toBeLessThanOrEqual(210.001);
      expect(at.y + at.height).toBeLessThanOrEqual(297.001);
      expect(at.width / at.height).toBeCloseTo(w / h, 5);
    }
  });
});

describe("a long table over several sheets", () => {
  const rows = (n: number, h: number, start = 100) => Array.from({ length: n }, (_, i) => start + (i + 1) * h);

  it("is one sheet when it fits, however many rows", () => {
    expect(planSheets(900, rows(8, 100), 100, 1000)).toEqual([{ from: 0, to: 900, withHeader: false }]);
  });

  it("cuts only between rows, repeats the column heads on every sheet after the first, and loses nothing", () => {
    const total = 100 + 70 * 20; // heads and 70 rows of 20
    const plan = planSheets(total, rows(70, 20), 100, 600);
    expect(plan.length).toBeGreaterThan(2);
    expect(plan[0]!.withHeader).toBe(false);
    expect(plan.slice(1).every((s) => s.withHeader)).toBe(true);
    expect(plan[0]!.from).toBe(0);
    expect(plan[plan.length - 1]!.to).toBe(total);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.from).toBe(plan[i - 1]!.to);
    for (const [i, s] of plan.entries()) {
      expect(s.to - s.from + (s.withHeader ? 100 : 0)).toBeLessThanOrEqual(600 * 1.01);
      if (i < plan.length - 1) expect(rows(70, 20)).toContain(s.to); // a row's bottom, never mid-row
    }
  });

  it("does not loop forever on a row taller than a sheet", () => {
    const plan = planSheets(5000, [4800], 100, 600);
    expect(plan.length).toBeLessThan(20);
    expect(plan[plan.length - 1]!.to).toBe(5000);
  });

  it("an empty table is one sheet", () => {
    expect(planSheets(300, [], 0, 1000)).toHaveLength(1);
  });
});

describe("edge cases of the documents", () => {
  it("a file name keeps the student's ID, so two students with Nepali-only names get different files", () => {
    expect(fileSafe("आदर्श मण्डल", "2083-00012", "First Terminal Examination", "2083")).toBe("2083-00012-First-Terminal-Examination-2083");
    expect(fileSafe("राम", "2083-00013", "First", "2083")).not.toBe(fileSafe("श्याम", "2083-00012", "First", "2083"));
  });

  it("a card with many subjects is drawn closer and has fewer empty activity rows, so it fits one sheet", () => {
    const many = renderToStaticMarkup(<GradeSheetDocument sheet={{ ...sheet, subjects: Array.from({ length: 18 }, (_, i) => ({ ...sheet.subjects[1]!, offeringId: `o${i}`, name: `Subject ${i}` })) }} />);
    expect(many).toMatch(/class="sheet paper dense"/);
    const rowsOf = (html: string) => (html.split("Other activities")[1] ?? "").split("<tr>").length - 1;
    expect(rowsOf(many)).toBeLessThan(rowsOf(renderToStaticMarkup(<GradeSheetDocument sheet={sheet} />)));
  });

  it("a card with no subjects still prints its head, tables and signatures without failing", () => {
    const html = renderToStaticMarkup(<GradeSheetDocument sheet={{ ...sheet, subjects: [], division: null }} />);
    expect(html).toContain("GRADE-SHEET");
    expect(html).toContain("Guardian signature");
  });

  it("HTML in a name is shown as text, never as markup", () => {
    const html = renderToStaticMarkup(<GradeSheetDocument sheet={{ ...sheet, student: { ...sheet.student, name: "<img src=x onerror=alert(1)>" } }} />);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("a ledger with no students or one student still prints its head and signatures", () => {
    const base = { ...ledger, students: [] };
    expect(renderToStaticMarkup(<MarkLedgerDocument ledger={base} />)).toContain("Approved by");
    expect(renderToStaticMarkup(<MarkLedgerDocument ledger={{ ...ledger, students: ledger.students.slice(0, 1) }} />)).toContain("Aadarsh Mandal");
  });

  it("a very long name sits in a capped cell so it wraps instead of pushing the last columns off the page", () => {
    const long = "Raghunandan Chaudhary Shrivastava Subramaniam Venkataraghavan Krishnamurthy";
    const html = renderToStaticMarkup(<MarkLedgerDocument ledger={{ ...ledger, students: [{ ...ledger.students[0]!, name: long }] }} />);
    expect(html).toMatch(/<span class="nameCell">Raghunandan/);
  });
});

describe("a document someone may not open", () => {
  it("is told as 'not for you', never as a failure with a Retry that could not work", () => {
    expect(notForYou("forbidden")).toEqual({ ok: false, reason: "forbidden" });
    expect(notForYou("not_found")).toEqual({ ok: false, reason: "forbidden" });
    expect(notForYou("failed")).toEqual({ ok: false, reason: "failed" });
  });
});
