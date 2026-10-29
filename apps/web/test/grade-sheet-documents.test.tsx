import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GradeSheetDocument, partCell, rangeText } from "@/results/GradeSheetDocument";
import { MarkLedgerDocument, columnName, markCell } from "@/results/MarkLedgerDocument";
import { fileSafe, fitOnA4 } from "@/results/download-pdf";
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
  it("names the file from letters and digits only", () => {
    expect(fileSafe("Apsara Singh", "First Terminal Examination", "2083")).toBe("Apsara-Singh-First-Terminal-Examination-2083");
    expect(fileSafe("  ", "")).toBe("document");
    expect(fileSafe("राम", "x/y")).toBe("x-y");
  });

  it("puts the page as large as fits on A4, inside its margins and centred, never off the page", () => {
    for (const [w, h] of [[800, 1100], [1000, 3000], [3000, 800]] as const) {
      const at = fitOnA4(w, h);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + at.width).toBeLessThanOrEqual(210);
      expect(at.y + at.height).toBeLessThanOrEqual(297);
      expect(at.width / at.height).toBeCloseTo(w / h, 5);
    }
  });
});
