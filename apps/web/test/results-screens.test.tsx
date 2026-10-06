import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SheetGrid, draftOf } from "@/results/MarkSheetScreen";
import { formatMarks, markText, parseMark, scoreText, type MarkSheet } from "@/results/model";
import { ResultsHome } from "@/results/ResultsHome";
import { ResultsTabs } from "@/results/ResultsTabs";
import { SubjectsTable, Top20Table, resultFigures, resultName } from "@/results/OwnResultsScreen";
import { RecheckList, SheetTable } from "@/results/StaffScreens";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/results",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const config = (top20: boolean): PublicConfig => ({
  school: {
    name: royal.school.name,
    shortName: royal.school.shortName,
    currency: "NPR",
    timezone: "Asia/Kathmandu",
    region: "nepal",
    template: null,
  },
  sections: TEST_SECTIONS.royal,
  modules: { results: true, top20 },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
});
const as = (role: string, scope: "institution" | "own" | "assigned" = "institution") =>
  fakeSession({
    status: "signedIn",
    me: { name: "Asha", roles: [{ role, scope }] },
  });
const inContext = (element: React.ReactNode, session = as("coordinator"), top20 = true) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(top20))}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("marks as typed and shown", () => {
  it("reads a number with up to two decimals, AB for absent, or blank; nothing else", () => {
    expect(parseMark("62.5")).toEqual({ valueHundredths: 6250, absent: false });
    expect(parseMark(" 70 ")).toEqual({ valueHundredths: 7000, absent: false });
    expect(parseMark("0.25")).toEqual({ valueHundredths: 25, absent: false });
    expect(parseMark("ab")).toEqual({ valueHundredths: null, absent: true });
    expect(parseMark("")).toEqual({ valueHundredths: null, absent: false });
    for (const bad of ["-1", "1.234", "7O", "1,000", "1e2"]) expect(parseMark(bad)).toBeNull();
  });

  it("writes whole hundredths the short way, with no floats", () => {
    expect([6250, 7000, 25, 5, 10].map(formatMarks)).toEqual(["62.5", "70", "0.25", "0.05", "0.1"]);
    expect(markText({ valueHundredths: null, absent: true })).toBe("AB");
    expect(scoreText({ percentHundredths: 8650 })).toBe("86.50%");
    expect(scoreText({ percentHundredths: 7290 })).toBe("72.90%");
  });
});

const sheet: MarkSheet = {
  sheetId: "s1",
  classId: "c1",
  programmeName: "Science",
  levelName: "Grade 11",
  label: "",
  offeringId: "o1",
  subjectName: "Physics",
  terminal: { id: "t1", name: "First terminal", weight: 30 },
  teacherName: "Gita Rai",
  status: "draft",
  note: null,
  components: [
    { id: "theory", name: "Theory", kind: "theory", maxHundredths: 7500 },
    { id: "practical", name: "Practical", kind: "practical", maxHundredths: 2500 },
  ],
  students: [
    {
      enrollmentId: "e1",
      sid: "2083-00001",
      name: "Sita Sharma",
      rollNo: 1,
      marks: [
        { componentId: "theory", valueHundredths: 6250, absent: false },
        { componentId: "practical", valueHundredths: null, absent: true },
      ],
    },
    {
      enrollmentId: "e2",
      sid: "2083-00002",
      name: "Hari Thapa",
      rollNo: 2,
      marks: [
        { componentId: "theory", valueHundredths: null, absent: false },
        { componentId: "practical", valueHundredths: null, absent: false },
      ],
    },
  ],
  missing: 2,
};

describe("the marks grid", () => {
  it("labels every box with the student and part, shows the paper's own maximum, and starts from the saved marks", () => {
    const html = inContext(<SheetGrid sheet={sheet} draft={draftOf(sheet)} editable />);
    expect(html).toContain('aria-label="Theory for Sita Sharma"');
    expect(html).toContain("Theory (of 75)");
    expect(html).toContain("Practical (of 25)");
    expect(html).toContain('value="62.5"');
    expect(html).toContain('value="AB"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('<th scope="row">Sita Sharma');
  });

  it("read-only shows the marks as text, with no boxes", () => {
    const html = inContext(<SheetGrid sheet={sheet} draft={draftOf(sheet)} editable={false} />);
    expect(html).not.toContain("<input");
    expect(html).toContain("62.5");
  });
});

describe("results places", () => {
  it("the Co-ordinator gets Review, Rechecks, Class sheets, Electives and Top 20; the Admin Changes, Class sheets and Top 20", () => {
    const coordinator = inContext(<ResultsTabs pathname="/portal/results" />);
    for (const href of ["/portal/results/rechecks", "/portal/results/sheets", "/portal/results/electives", "/portal/results/top20"]) expect(coordinator).toContain(href);
    const admin = inContext(<ResultsTabs pathname="/portal/results" />, as("admin"));
    expect(admin).toContain("Changes");
    expect(admin).not.toContain("/portal/results/electives");
    expect(admin).not.toContain(">Review<");
  });

  it("no Top 20 tab where the school switched it off; no tabs for a teacher or a student", () => {
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("coordinator"), false)).not.toContain("/portal/results/top20");
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("teacher", "assigned"))).toBe("");
    expect(inContext(<ResultsTabs pathname="/portal/results" />, as("student", "own"))).toBe("");
  });

  it("each role lands on its own place, showing the shape of the page while it loads", () => {
    expect(inContext(<ResultsHome />, as("student", "own"))).toContain("Your results");
    expect(inContext(<ResultsHome />, as("teacher", "assigned"))).toContain("Marks");
    expect(inContext(<ResultsHome />)).toContain("Review results");
    expect(inContext(<ResultsHome />, as("admin"))).toContain("Changes after publishing");
    expect(inContext(<ResultsHome />)).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});

describe("the Principal reads results (D-104, after the PM's topic 7 reference)", () => {
  const naming = { programmeName: "+2 Science", levelName: "Grade 11", label: "A" };
  const sheet = {
    classId: "c1",
    ...naming,
    terminal: null,
    graded: true,
    publishedAt: "2026-10-01T05:00:00.000Z",
    subjects: [
      { offeringId: "o1", name: "English" },
      { offeringId: "o2", name: "Physics" },
    ],
    students: [
      { enrollmentId: "e1", cardId: "k1", sid: "2083-00001", name: "Aarav Mandal", rank: 1, percentHundredths: 8850, passed: true, outcome: "A", version: 1, subjects: [{ offeringId: "o1", grade: "A", percentHundredths: 8500 }, { offeringId: "o2", grade: "A+", percentHundredths: 9200 }] },
      { enrollmentId: "e2", cardId: "k2", sid: "2083-00002", name: "Sita Chaudhary", rank: 1, percentHundredths: 8850, passed: true, outcome: "A", version: 2, subjects: [{ offeringId: "o1", grade: "A+", percentHundredths: 9100 }, null] },
    ],
  };

  it("the final's class sheet: rank, the student opening their marks card, marks and grades, the percentage; ties share a rank; a corrected one says so", () => {
    const html = inContext(<SheetTable sheet={sheet} />, as("admin"));
    expect(html).toContain('href="/portal/results/card?id=k1"');
    expect(html.match(/<td data-align="end">1<\/td>/g)).toHaveLength(2);
    expect(html).toContain("92.00 (A+)");
    expect(html).toContain("88.50%");
    expect(html).toContain("Final result");
    expect(html).toContain(">Corrected<");
    expect(html).toContain("data-sticky"); // the student column stays in view while the subjects scroll
    expect(html).toMatch(/role="region"[^>]*tabindex="0"|tabindex="0"[^>]*role="region"/i);
  });

  it("an exam's class sheet is for information: no rank column", () => {
    const html = inContext(<SheetTable sheet={{ ...sheet, terminal: { id: "t1", name: "First terminal" }, students: sheet.students.map((x) => ({ ...x, rank: null, passed: null })) }} />, as("admin"));
    expect(html).not.toContain(">Rank<");
    expect(html).toContain("First terminal");
  });

  const recheck = {
    id: "r1",
    offeringId: "o2",
    subjectName: "Physics",
    reason: "Question 4 was not added",
    status: "changed" as const,
    requestedAt: "2026-10-01T05:00:00.000Z",
    requestedOnBs: "2083-06-15",
    decisionReason: "Added question 4",
    decidedAt: "2026-10-02T05:00:00.000Z",
    decidedOnBs: "2083-06-16",
    decidedBy: "Support",
    classId: "c1",
    ...naming,
    terminalName: "First terminal",
    studentName: "Sita Chaudhary",
    sid: "2083-00002",
    marks: [{ componentId: "theory" as const, name: "Theory", maxHundredths: 7500, valueHundredths: 6000, absent: false }],
  };

  it("a change after publishing: student and subject, status in words, why, the marks now, who decided and when, in BS; no controls", () => {
    const html = inContext(<RecheckList rechecks={[recheck]} />, as("admin"));
    for (const text of ["Sita Chaudhary · Physics", ">Marks changed<", "Asked: Question 4 was not added", "Theory 60 of 75", "Decided by Support on 16 Ashwin 2083: Added question 4", "asked 15 Ashwin 2083"]) expect(html).toContain(text);
    expect(html).not.toMatch(/<(input|button|select)/);
  });

  it("Top 20: rank and name, with the class only when the server gives it", () => {
    const html = inContext(<Top20Table entries={[{ rank: 1, name: "Aarav Mandal", className: "Grade 11 · A" }, { rank: 1, name: "Sita Chaudhary", className: "Grade 11 · A" }]} />, as("admin"));
    expect(html).toContain("Grade 11 · A");
    expect(inContext(<Top20Table entries={[{ rank: 1, name: "Aarav Mandal" }]} />, as("student", "own"))).not.toContain(">Class<");
  });
});

describe("a student's results on the exam pattern (D-117)", () => {
  const student = { name: "Sita Chaudhary", sid: "2083-00002", rollNo: 2 };
  const klass = { programmeName: "+2 Science", levelName: "Grade 11", label: "A", sectionName: "+2", yearLabel: "2083" };
  const card = <B,>(body: B) => ({ id: "k1", version: 1, publishedAt: "2026-10-01T05:00:00.000Z", publishedAtBs: "2083-06-15", reason: null, body });
  const part = (max: number, value: number | null) => ({ maxHundredths: max, valueHundredths: value, absent: value === null });
  const terminal = {
    publicationId: "p1",
    yearLabel: "2083",
    kind: "terminal" as const,
    terminalName: "First terminal",
    rechecks: [],
    card: card({
      kind: "terminal" as const,
      student,
      class: klass,
      terminal: { name: "First terminal", weight: 30 },
      graded: true,
      subjects: [{ offeringId: "o1", name: "Physics", theory: part(7500, 6000), practical: part(2500, null), obtainedHundredths: 6000, fullHundredths: 10000, percentHundredths: 6000, scaledHundredths: 1800, grade: "B" }],
      percentHundredths: 6000,
      grade: "B",
      outcome: "B",
    }),
  };
  const final = {
    publicationId: "p2",
    yearLabel: "2083",
    kind: "final" as const,
    terminalName: null,
    rechecks: [],
    card: card({
      kind: "final" as const,
      student,
      class: klass,
      pattern: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ id: "t1", name: "First terminal", weight: 100 }] },
      subjects: [
        { offeringId: "o1", name: "Physics", terminals: [], finalHundredths: 3750, theoryPercentHundredths: 2545, practicalPercentHundredths: 9000, passed: false, grade: null },
        { offeringId: "o2", name: "English", terminals: [], finalHundredths: 8550, theoryPercentHundredths: 8550, practicalPercentHundredths: null, passed: true, grade: null },
      ],
      percentHundredths: 6150,
      passed: false,
      grade: null,
      outcome: "Fail",
    }),
  };

  it("names each result: the exam and term, or the final result", () => {
    expect(resultName(terminal)).toBe("First terminal, 2083");
    expect(resultName(final)).toBe("Final result, 2083");
  });

  it("an exam's figures are for information: its percentage, grade and share of the final, no pass or fail", () => {
    expect(resultFigures(terminal).map((f) => [f.key, f.value])).toEqual([
      ["score", "60.00%"],
      ["grade", "B"],
      ["weight", "30%"],
    ]);
  });

  it("the final's figures: its percentage, the result, and the subjects passed", () => {
    expect(resultFigures(final).map((f) => [f.key, f.value])).toEqual([
      ["score", "61.50%"],
      ["result", "Fail"],
      ["subjects", "1 of 2"],
    ]);
  });

  it("an exam's subjects show the paper as entered, theory and practical, with AB for an absence", () => {
    const html = inContext(<SubjectsTable result={terminal} />, as("student", "own"));
    expect(html).toContain("Theory 60 of 75 · Practical AB of 25");
    expect(html).toContain("60.00%");
    expect(html).not.toContain("Passed");
  });

  it("the final's subjects show the mark out of 100 and passed or not, in words", () => {
    const html = inContext(<SubjectsTable result={final} />, as("student", "own"));
    expect(html).toContain("37.50");
    expect(html).toContain(">Passed<");
    expect(html).toContain(">Below pass<");
  });
});
