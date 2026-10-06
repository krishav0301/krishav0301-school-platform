import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnswerList, assignmentFigures } from "@/classwork/AssignmentScreen";
import { GivenList, SetWorkList, givenFigures, givenState, setWorkFigures } from "@/classwork/HomeworkScreen";
import type { AssignmentDetail, StudentAssignments, TeacherAssignments } from "@/classwork/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { totalsFigures } from "@/fees/FeesHome";
import { structureFigures } from "@/fees/StructuresScreen";
import { VoucherRows, voucherFigures } from "@/fees/VouchersScreen";
import { MySheetsTable, currentTerminal, mySheetFigures, sheetsOf } from "@/results/MarkSheetScreen";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { fees: true, homework: true, results: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const as = (role: string, scope: "institution" | "own" | "assigned") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("teacher", "assigned")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const naming = { programmeName: "+2 Science", levelName: "Grade 11", label: "A" };
const due = { dueAt: "2026-10-08T15:31:00.000Z", dueDateBs: "2083-06-22" };

describe("homework, for the teacher who set it (D-107)", () => {
  const set = (over: Partial<TeacherAssignments["assignments"][number]>): TeacherAssignments["assignments"][number] => ({
    id: "a1", title: "Essay", instructions: "300 words.", link: null, ...due, maxMarks: 20, subjectName: "English", classId: "c1", ...naming, withdrawn: false, students: 6, submitted: 1, toReview: 0, requests: 0, ...over,
  });

  it("what needs the teacher comes first, a withdrawn piece last, each with its state in words and its page", () => {
    const html = inContext(<SetWorkList assignments={[set({ id: "w", title: "Old", withdrawn: true }), set({ id: "q", title: "Quiet" }), set({ id: "r", title: "Waiting", toReview: 2 })]} />);
    expect(html.indexOf("Waiting")).toBeLessThan(html.indexOf("Quiet"));
    expect(html.indexOf("Quiet")).toBeLessThan(html.indexOf("Old"));
    expect(html).toMatch(/data-tone="warn"[^>]*>2 to review</);
    expect(html).toContain(">Up to date<");
    expect(html).toContain(">Withdrawn<");
    expect(html).toContain("Due 22 Ashwin 2083");
    expect(html).toContain('href="/portal/classwork/homework/assignment?id=r"');
    expect(html).toContain('aria-label="Open “Waiting”"');
  });

  it("the figures count only work still open", () => {
    const figures = setWorkFigures({ assignments: [set({ toReview: 2, requests: 1 }), set({ id: "w", withdrawn: true, toReview: 5 })] });
    expect(figures.map((f) => f.value)).toEqual(["1", "2", "1"]);
  });

  it("one piece: answers to review first, then the rest, not handed in last; only a handed-in answer opens", () => {
    const sub = (status: "submitted" | "reviewed" | "resubmit_requested") => ({ id: `s-${status}`, status, isLate: status === "submitted", body: "x", submittedAt: "2026-10-03T00:00:00Z", marks: null, feedback: null, resubmitReason: null, attempts: 1 });
    const detail = {
      id: "a1", title: "Essay", instructions: "300 words.", link: null, ...due, maxMarks: 20, subjectName: "English", classId: "c1", ...naming, withdrawn: false,
      students: [
        { enrollmentId: "e1", sid: "2083-00001", name: "Aarav", submission: null },
        { enrollmentId: "e2", sid: "2083-00002", name: "Bina", submission: sub("reviewed") },
        { enrollmentId: "e3", sid: "2083-00003", name: "Kritika", submission: sub("submitted") },
      ],
    } as AssignmentDetail;
    expect(assignmentFigures(detail).map((f) => f.value)).toEqual(["2 of 3", "1", "1", "0"]);
    const html = inContext(<AnswerList students={detail.students} onOpen={() => {}} />);
    expect(html.indexOf("Kritika")).toBeLessThan(html.indexOf("Bina"));
    expect(html.indexOf("Bina")).toBeLessThan(html.indexOf("Aarav"));
    expect(html).toContain('aria-label="Open Kritika&#x27;s answer"');
    expect(html).not.toContain("Open Aarav");
    expect(html).toMatch(/data-tone="bad"[^>]*>Late</);
  });
});

describe("homework, for the student (D-107)", () => {
  const given = (over: Partial<StudentAssignments["assignments"][number]>): StudentAssignments["assignments"][number] => ({
    id: "g1", title: "Essay", instructions: "300 words.", link: null, ...due, maxMarks: 20, subjectName: "English", teacherName: "Anita Mandal", submission: null, ...over,
  });
  const sent = { id: "s1", status: "submitted" as const, isLate: false, body: "x", submittedAt: "2026-10-03T00:00:00Z", marks: null, feedback: null, resubmitReason: null, attempts: 1 };

  it("what is still to hand in comes first, with Hand in named for it; handed in says so in words", () => {
    const html = inContext(<GivenList assignments={[given({ id: "done", title: "Handed", submission: sent }), given({ id: "open", title: "Still open" })]} onOpen={() => {}} />, as("student", "own"));
    expect(html.indexOf("Still open")).toBeLessThan(html.indexOf("Handed"));
    expect(html).toContain('aria-label="Hand in “Still open”"');
    expect(html).toMatch(/data-tone="warn"[^>]*>Not submitted</);
    expect(givenState(given({ submission: { ...sent, status: "resubmit_allowed" } }))).toEqual({ tone: "warn", text: "You may resubmit" });
    expect(givenFigures({ assignments: [given({}), given({ id: "b", submission: { ...sent, status: "reviewed" } })] }).map((f) => f.value)).toEqual(["1", "1", "1"]);
  });
});

describe("a teacher's mark sheets (D-107)", () => {
  const mine = {
    terminals: [
      { id: "t1", name: "First terminal", weight: 40 },
      { id: "t2", name: "Second terminal", weight: 60 },
    ],
    subjects: [
      { classId: "c1", ...naming, offeringId: "o1", subjectName: "English", sheets: [{ terminalId: "t1", status: "published" as const, note: null }, { terminalId: "t2", status: "not_started" as const, note: null }] },
      { classId: "c1", ...naming, offeringId: "o2", subjectName: "Computer Science", sheets: [{ terminalId: "t1", status: "draft" as const, note: "Check Q4" }, { terminalId: "t2", status: "not_started" as const, note: null }] },
    ],
  };

  it("opens on the latest terminal the teacher has started; sent back comes first and says so", () => {
    expect(currentTerminal(mine)).toBe("t1");
    const rows = sheetsOf(mine, "t1");
    expect(rows.map((r) => r.subjectName)).toEqual(["Computer Science", "English"]);
    expect(mySheetFigures(rows).map((f) => f.value)).toEqual(["1", "1", "0", "1"]);
    const html = inContext(<MySheetsTable rows={rows} terminalName="First terminal" />);
    expect(html).toMatch(/data-tone="bad"[^>]*>Sent back/);
    expect(html).toContain(">Enter marks<");
    expect(html).toContain('href="/portal/results/sheet?class=c1&amp;subject=o2&amp;terminal=t1"');
    expect(html).toContain('aria-label="Open the mark sheet for Computer Science, +2 Science · Grade 11 · A"');
  });
});

describe("the Accountant's lists (D-107)", () => {
  it("deposits to check: the count and amount, each row named, with Check", () => {
    const list = { vouchers: [{ id: "v1", enrollmentId: "e1", studentName: "Kritika Jha", sid: "2083-00007", amountPaisa: 350_000, bank: "Nabil Bank", reference: "NB-1", paidOn: "2026-10-03", paidOnBs: "2083-06-17", submittedAt: "2026-10-03T00:00:00Z" }] };
    expect(voucherFigures(list).map((f) => f.value)).toEqual(["1", "NPR 3,500"]);
    const html = inContext(<VoucherRows vouchers={list.vouchers} onOpen={() => {}} />, as("accountant", "institution"));
    expect(html).toContain("2083-00007 · Nabil Bank · NB-1 · 17 Ashwin 2083");
    expect(html).toContain('aria-label="Check Kritika Jha&#x27;s deposit"');
    expect(inContext(<VoucherRows vouchers={[]} />, as("accountant", "institution"))).toContain("No vouchers waiting.");
  });

  it("the year's totals and the structures at a glance", () => {
    expect(totalsFigures({ chargedPaisa: 4_250_000, discountPaisa: 0, paidPaisa: 2_000_000, duePaisa: 2_250_000, overduePaisa: 0 }).map((f) => [f.value, f.tone])).toEqual([
      ["NPR 42,500", "accent"],
      ["NPR 20,000", "ok"],
      ["NPR 22,500", "warn"],
      ["NPR 0", "ok"],
    ]);
    const s = (id: string, status: "draft" | "waiting" | "live") => ({ id, levelId: id, status, yearLabel: "2083", programmeName: "+2 Science", levelName: "Grade 11", sectionKey: "plus2", yearlyTotalPaisa: 0 });
    expect(structureFigures({ structures: [s("a", "live"), s("b", "waiting"), s("c", "draft")] }, 2).map((f) => f.value)).toEqual(["1", "1", "1", "2"]);
  });
});
