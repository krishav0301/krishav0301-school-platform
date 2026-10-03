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
const session = fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role: "coordinator", scope: "institution" }] } });
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
      ["registers", "1 of 4"],
      ["verify", "2"],
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
    for (const item of CHECKLIST) expect(html).toContain(`href="${item.href}"`);
    expect(html.indexOf("Add programmes and levels")).toBeLessThan(html.indexOf("Set an active academic year"));
    expect((html.match(/>Not done</g) ?? []).length).toBe(6);
    expect((html.match(/>Done</g) ?? []).length).toBe(1);
  });

  it("once every step is done, says so in one line", () => {
    const html = inContext(<SetupList checklist={full} />);
    expect(html).toContain("Everything is set up for this year.");
    expect(html).not.toContain("Not done");
  });
});
