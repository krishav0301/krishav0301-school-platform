import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import type { ReviewBoard } from "@/results/model";
import { BoardClassPanel, ReviewBoardScreen, boardFigures, classState } from "@/results/ReviewScreen";
import { DecidePanel, ElectivesView, electiveFigures, recheckFigures } from "@/results/StaffScreens";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/results", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { results: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const session = fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role: "coordinator", scope: "institution" }] } });
const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const noop = () => {};

type Cls = ReviewBoard["classes"][number];
const subject = (offeringId: string, subjectName: string, status: Cls["subjects"][number]["status"], over: Partial<Cls["subjects"][number]> = {}): Cls["subjects"][number] => ({
  offeringId,
  subjectName,
  teacherName: "Anita Mandal",
  sheetId: status === "not_started" ? null : `sheet-${offeringId}`,
  status,
  missing: 0,
  ...over,
});
const cls = (over: Partial<Cls> = {}): Cls => ({
  classId: "c1",
  programmeName: "+2 Science",
  levelName: "Grade 11",
  label: "A",
  gradingPolicy: "neb_gpa",
  published: false,
  ready: false,
  subjects: [subject("o1", "Biology", "under_review"), subject("o2", "Physics", "verified"), subject("o3", "Nepali", "not_started", { teacherName: null, missing: 4 })],
  ...over,
});
const board: ReviewBoard = { terminals: [{ id: "t1", name: "First terminal" }], terminalId: "t1", classes: [cls(), cls({ classId: "c2", label: "B", published: true, ready: true, subjects: [subject("o4", "English", "published")] })] };

describe("the Co-ordinator's review board (D-106)", () => {
  it("shows its title at once and the shape of the page while it loads", () => {
    const html = inContext(<ReviewBoardScreen />);
    expect(html).toContain(">Review results</h1>");
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });

  it("four figures for the terminal", () => {
    expect(boardFigures(board).map((f) => [f.key, f.value])).toEqual([
      ["classes", "2"],
      ["waiting", "1"],
      ["verified", "1"],
      ["published", "1"],
    ]);
  });

  it("a class's state in words: in progress, ready, no grading set, published", () => {
    expect(classState(cls()).key).toBe("results.review.inProgress");
    expect(classState(cls({ ready: true })).key).toBe("results.review.ready");
    expect(classState(cls({ gradingPolicy: null })).key).toBe("results.review.noPolicy");
    expect(classState(cls({ published: true })).key).toBe("results.status.published");
  });

  it("a class card: a box only for a sheet waiting to be verified, each status in words, and Publish held until every subject is verified", () => {
    const html = inContext(<BoardClassPanel cls={cls()} terminalId="t1" chosen={new Set()} busy={null} onChoose={noop} onPublish={noop} />);
    expect(html).toContain("+2 Science · Grade 11 · A");
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(1);
    expect(html).toContain(">Under review<");
    expect(html).toContain(">Verified<");
    expect(html).toContain(">Not started<");
    expect(html).toContain("4 missing");
    expect(html).toContain("No teacher assigned");
    expect(html).toContain('aria-label="Open Biology"');
    expect(html).not.toContain('aria-label="Open Nepali"'); // nothing to open yet
    expect(html).toContain("Publish is waiting for: Biology (Under review), Nepali (Not started).");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publish results</);
  });

  it("a published class links to its sheet instead of offering Publish", () => {
    const html = inContext(<BoardClassPanel cls={board.classes[1]!} terminalId="t1" chosen={new Set()} busy={null} onChoose={noop} onPublish={noop} />);
    expect(html).toContain(">Published<");
    expect(html).toContain("/portal/results/sheets?class=c2&amp;terminal=t1");
    expect(html).not.toContain("Publish results");
  });
});

describe("rechecks and electives for the Co-ordinator (D-106)", () => {
  const open = {
    id: "r1",
    offeringId: "o2",
    subjectName: "Physics",
    reason: "Question 4 was not added",
    status: "open" as const,
    requestedAt: "2026-10-01T05:00:00.000Z",
    requestedOnBs: "2083-06-15",
    decisionReason: null,
    decidedAt: null,
    decidedOnBs: null,
    decidedBy: null,
    classId: "c1",
    programmeName: "+2 Science",
    levelName: "Grade 11",
    label: "A",
    terminalName: "First terminal",
    studentName: "Sita Chaudhary",
    sid: "2083-00002",
    marks: [{ componentId: "m1", name: "Theory", maxHundredths: 7500, valueHundredths: 6000, absent: false }],
  };

  it("an open recheck is decided in a panel: why it was asked, the marks to correct, a reason, and one button", () => {
    const html = inContext(<DecidePanel recheck={open} onClose={noop} onDone={noop} />);
    expect(html).toContain(">Sita Chaudhary · Physics</h2>");
    expect(html).toContain("2083-00002 · +2 Science · Grade 11 · A · First terminal");
    expect(html).toContain("Question 4 was not added");
    expect(html).toContain("Theory (of 75.00)");
    expect(html).toContain('value="60"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>No change</); // a reason first
  });

  it("the figures count the open, changed and unchanged rechecks", () => {
    expect(recheckFigures([open, { ...open, id: "r2", status: "changed" }, { ...open, id: "r3", status: "unchanged" }]).map((f) => f.value)).toEqual(["1", "1", "1"]);
  });

  const electives = {
    classId: "c1",
    programmeName: "+2 Science",
    levelName: "Grade 11",
    label: "A",
    groups: [{ id: "g1", name: "Science option", pickCount: 1, subjects: [{ offeringId: "o1", name: "Biology" }, { offeringId: "o2", name: "Computer Science" }] }],
    students: [
      { enrollmentId: "e1", sid: "2083-00001", name: "Asha Rai", picks: ["o1"] },
      { enrollmentId: "e2", sid: "2083-00002", name: "Bimal Shah", picks: [] },
    ],
  };

  it("each student with a picker for each group, and figures for who still has to choose", () => {
    const html = inContext(<ElectivesView data={electives} onSaved={noop} />);
    expect(html).toContain(">Asha Rai</h3>");
    expect(html).toContain("2083-00002");
    expect((html.match(/<select/g) ?? []).length).toBe(2);
    expect(electiveFigures(electives).map((f) => f.value)).toEqual(["2", "1", "1"]);
    expect(inContext(<ElectivesView data={{ ...electives, groups: [] }} onSaved={noop} />)).toContain("no elective groups");
  });
});
