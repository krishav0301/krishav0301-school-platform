import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { CHECKLIST, CoordinatorDashboard, CoordinatorDayView, SetupList, dayFigures, dayRows, type SchoolDay } from "@/dashboard/CoordinatorDashboard";
import type { Checklist } from "@/setup/checklist-client";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { attendance: true, teacher_attendance: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const session = fakeSession({ status: "signedIn", me: { id: "user-1", name: "Sita", roles: [{ role: "coordinator", scope: "institution" }] } });
const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const empty: Checklist = { year: false, structure: false, classes: false, terminals: false, subjects: false, teachers: false, classTeachers: false };
const full: Checklist = { year: true, structure: true, classes: true, terminals: true, subjects: true, teachers: true, classTeachers: true };
const day = (over: Partial<SchoolDay> = {}): SchoolDay => ({
  todayBs: "2083-06-17",
  waiting: 3,
  registers: { marked: 1, total: 4 },
  teachersSaved: false,
  logs: { complete: 0, total: 4 },
  toVerify: 2,
  checklist: full,
  ...over,
});

describe("the Co-ordinator's home (D-106)", () => {
  it("greets by name with the role and scope at once, and shows the shape of the day while it loads", () => {
    const html = inContext(<CoordinatorDashboard />);
    expect(html).toMatch(/<h1[^>]*>Good (morning|afternoon|evening), Sita<\/h1>/);
    expect(html).toContain(" · Whole institution");
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });

  it("under the greeting: the figures, today's work, the setup checklist and what the role can do", () => {
    const html = inContext(<CoordinatorDayView day={day()} />);
    expect(html).toContain("Today at a glance");
    expect(html).toContain(">Today</h2>");
    expect(html).toContain(">Setup checklist</h2>");
    expect(html).toContain("What you can do as");
  });

  it("four figures, each the same fact as a line below", () => {
    const figures = dayFigures(day());
    expect(figures.map((f) => [f.key, f.value])).toEqual([
      ["waiting", "3"],
      ["verify", "2"],
      ["registers", "1 of 4"],
      ["setup", "7 of 7"],
    ]);
  });

  it("leaves out what a switched-off module would say", () => {
    const d = day({ registers: null, teachersSaved: null, toVerify: null });
    expect(dayFigures(d).map((f) => f.key)).toEqual(["waiting", "setup"]);
    expect(dayRows(d).map((r) => r.key)).toEqual(["applications", "logs"]);
  });

  it("each line says where it stands in words and links to where it is done", () => {
    const rows = dayRows(day());
    expect(rows.map((r) => [r.key, r.todo, r.href])).toEqual([
      ["applications", true, "/portal/admissions"],
      ["registers", true, "/portal/attendance"],
      ["teachers", true, "/portal/attendance/teachers"],
      ["logs", true, "/portal/classwork"],
      ["verify", true, "/portal/results/review"],
    ]);
    const calm = dayRows(day({ waiting: 0, registers: { marked: 4, total: 4 }, teachersSaved: true, logs: { complete: 4, total: 4 }, toVerify: 0 }));
    expect(calm.every((r) => !r.todo)).toBe(true);
    expect(calm[0]!.meta).toBe("None waiting");
  });
});

describe("the setup checklist", () => {
  it("lists the steps still to do first, each with its link and a status in words", () => {
    const html = inContext(<SetupList checklist={{ ...empty, year: true }} />);
    // Only what is left, under a progress bar; the done step is not repeated (the PM, 2026-10-17).
    for (const item of CHECKLIST.filter((i) => i.key !== "year")) expect(html).toContain(`href="${item.href}"`);
    expect(html).not.toContain("An open academic term");
    expect(html).toContain("Add Courses and Levels");
    expect(html).toMatch(/role="img" aria-label="1 of 7 done"/);
    expect((html.match(/>Not done</g) ?? []).length).toBe(6);
    expect((html.match(/>Done</g) ?? []).length).toBe(0);
  });

  it("a figure is a link to where it is dealt with", () => {
    const links = Object.fromEntries(dayFigures(day()).map((f) => [f.key, f.href]));
    expect(links).toEqual({ waiting: "/portal/admissions", verify: "/portal/results", registers: "/portal/attendance", setup: "/portal/setup" });
  });

  it("once every step is done, says so in one line", () => {
    const html = inContext(<SetupList checklist={full} />);
    expect(html).toContain("Everything is set up for the open terms.");
    expect(html).not.toContain("Not done");
  });
});

// --- The progress and "needs you" panels (the PM, 2026-10-17) ---------------------------------------------------------
import { NeedsPanel, PipelinePanel, needsOf, pipelineOf } from "@/dashboard/CoordinatorPanels";
import type { ReviewBoard } from "@/results/model";

type BoardClass = ReviewBoard["classes"][number];
const sub = (offeringId: string, status: BoardClass["subjects"][number]["status"]): BoardClass["subjects"][number] => ({ offeringId, subjectName: offeringId, teacherName: null, sheetId: null, status, missing: 0 });
const klass = (classId: string, programmeName: string, subjects: BoardClass["subjects"], over: Partial<BoardClass> = {}): BoardClass => ({ classId, programmeName, levelName: "Grade 11", label: "A", published: false, finalPublished: false, ready: false, subjects, ...over });
const board: ReviewBoard = {
  terminals: [{ id: "t1", name: "First Terminal", weight: 40 }],
  terminalId: "t1",
  classes: [
    klass("c1", "Science", [sub("a", "verified"), sub("b", "under_review"), sub("c", "not_started")]),
    klass("c2", "Science", [sub("d", "published")], { published: true, ready: true, label: "B" }),
    klass("c3", "Management", [sub("e", "verified"), sub("f", "verified")], { ready: true }),
  ],
};

describe("marks progress by department", () => {
  it("counts each department's subjects by stage and how many are verified", () => {
    const p = pipelineOf(board)!;
    expect(p.exam).toBe("First Terminal");
    expect(p.departments.map((d) => [d.name, d.total, d.done])).toEqual([["Management", 2, 2], ["Science", 4, 2]]);
    expect(p.departments[1]!.counts).toEqual({ published: 1, verified: 1, under_review: 1, draft: 0, not_started: 1 });
    expect([p.classesReady, p.classesPublished, p.classesTotal]).toEqual([2, 1, 3]);
  });

  it("is nothing when there is no exam or no class", () => {
    expect(pipelineOf({ ...board, terminalId: null })).toBeNull();
    expect(pipelineOf({ ...board, classes: [] })).toBeNull();
  });

  it("is one bar per department with its numbers in words, the stages named once, and a link to the review board", () => {
    const html = inContext(<PipelinePanel pipeline={pipelineOf(board)!} />);
    expect(html).toContain("Marks progress, First Terminal");
    expect(html).toContain("2 of 4 verified");
    expect(html).toContain("2 of 2 verified");
    expect(html).toMatch(/role="img" aria-label="Published: 1, Verified: 1, Under review: 1, Draft: 0, Not started: 1"/);
    expect(html).toContain('href="/portal/results"');
    expect((html.match(/class="dot"/g) ?? []).length).toBe(5);
  });
});

describe("what needs the Co-ordinator", () => {
  const hub = (id: string, teacher: string | null) => ({ id, termId: "y", termLabel: "2082/83", courseId: "co", levelId: "lv", classTeacherId: teacher ? "u" : null, wing: "+2", course: "Science", level: "Grade 11", section: id.toUpperCase(), classTeacher: teacher, students: 5, isClassTeacher: false });

  it("is one short chip for each kind: the oldest application waiting, classes ready to publish, classes with no Class Teacher", () => {
    const needs = needsOf({ oldestWaitingDays: 4, classes: [hub("a", null), hub("c", null), hub("b", "Sunita Rai")], board });
    expect(needs.map((n) => [n.key, n.text, n.href])).toEqual([
      ["oldest", "Oldest application waiting 4 days", "/portal/admissions"],
      ["ready", "2 classes ready to publish", "/portal/results"],
      ["teacher", "2 classes have no Class Teacher", "/portal/setup/teaching"],
    ]);
    expect(needs[0]!.tone).toBe("bad");
    expect(needsOf({ oldestWaitingDays: 1, classes: [hub("a", null)], board: null }).map((n) => n.text)).toEqual(["Oldest application waiting 1 day", "1 class has no Class Teacher"]);
  });

  it("a new application is not yet a need, and nothing is listed when all is well", () => {
    expect(needsOf({ oldestWaitingDays: 0, classes: [hub("a", "Sunita Rai")], board: null })).toEqual([]);
    expect(needsOf({ oldestWaitingDays: null, classes: null, board: null })).toEqual([]);
  });

  it("shows chips, or a calm line when nothing needs them", () => {
    expect(inContext(<NeedsPanel needs={needsOf({ oldestWaitingDays: 2, classes: null, board: null })} />)).toContain("Oldest application waiting 2 days");
    expect(inContext(<NeedsPanel needs={[]} />)).toContain("Nothing needs you right now.");
  });

  it("the home shows both panels when it has them, and neither when it has not", () => {
    const withBoth = inContext(<CoordinatorDayView day={day({ pipeline: pipelineOf(board), needs: needsOf({ oldestWaitingDays: 2, classes: null, board }) })} />);
    expect(withBoth).toContain("Needs you");
    expect(withBoth).toContain("Marks progress, First Terminal");
    const without = inContext(<CoordinatorDayView day={day()} />);
    expect(without).not.toContain("Needs you");
    expect(without).not.toContain("Marks progress");
  });
});
