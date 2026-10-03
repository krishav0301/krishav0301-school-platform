import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TeachingPage from "@/app/portal/people/teaching/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { TeachersTable, byTeacher } from "@/people/TeachingRead";
import { TeachingScreen, TeachingView } from "@/people/TeachingScreen";
import type { Teaching } from "@/people/teaching-model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/people/teaching", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "role.coordinator": "Vice Principal" },
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section", section?: string) =>
  fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope, ...(section ? { section } : {}) }] } });
const inContext = (element: React.ReactNode, session = as("coordinator", "institution")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const noop = () => {};
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const teaching = (over: Partial<Teaching> = {}): Teaching => ({
  classId: "c1",
  classLabel: "",
  levelName: "Grade 11",
  classTeacher: { id: "t1", fullName: "Sita Sharma" },
  assignments: [
    { offeringId: "o1", subjectName: "Physics", teacher: { id: "t1", fullName: "Sita Sharma" } },
    { offeringId: "o2", subjectName: "Chemistry", teacher: null },
  ],
  teachers: [
    { id: "t1", fullName: "Sita Sharma" },
    { id: "t2", fullName: "Ram Karki" },
  ],
  ...over,
});

// ---------------------------------------------------------------------------------------------
describe("the teaching view", () => {
  it("for someone who may manage: a Class Teacher picker and one teacher picker per subject, each pre-filled with the current teacher", () => {
    const html = inContext(<TeachingView teaching={teaching()} canManage busy={null} onAssign={noop} onClassTeacher={noop} />);
    expect(html).toContain(">Class Teacher<");
    expect(html).toContain(">Physics</h3>");
    expect(html).toContain(">Chemistry</h3>");
    expect(html).toContain(">Teacher for Physics<");
    expect(html).toContain(">Teacher for Chemistry<");
    expect(html).toContain(">Sita Sharma<");
    expect(html).toContain(">Ram Karki<");
    expect(html).toContain(">— None —<");
  });

  it("for a reader: the same facts, but no pickers", () => {
    const html = inContext(<TeachingView teaching={teaching()} canManage={false} busy={null} onAssign={noop} onClassTeacher={noop} />);
    expect(html).not.toContain("<select");
    expect(html).toContain("Sita Sharma");
    expect(html).toContain("Physics");
  });

  it("says so, with the next step, when a class has no subjects yet", () => {
    const html = inContext(<TeachingView teaching={teaching({ assignments: [] })} canManage busy={null} onAssign={noop} onClassTeacher={noop} />);
    expect(html).toContain("no subjects yet");
    expect(html).toContain("Curriculum");
  });

  it("a subject with no teacher offers the none option among the pickable teachers", () => {
    const html = inContext(<TeachingView teaching={teaching()} canManage busy={null} onAssign={noop} onClassTeacher={noop} />);
    expect(count(html, /<option value=""[^>]*>— None —<\/option>/g)).toBe(3); // Class Teacher and both subjects
  });
});

// ---------------------------------------------------------------------------------------------
describe("the teaching screen and its page", () => {
  it("shows the shape of the page while it loads", () => {
    const html = inContext(<TeachingScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Teaching</h1>");
  });

  it("the page has the People sub-menu and the portal around it", () => {
    const html = inContext(<TeachingPage />);
    expect(html).toContain(">Teaching</h1>");
    expect(html).toContain(">Staff<");
    expect(html).toContain(">Teaching<");
    expect(html).toContain("Skip to main content");
  });

  it("a reader sees the read-only notice", () => {
    const html = inContext(<TeachingScreen />, as("admin", "institution"));
    expect(html).toContain("Read only. The Vice Principal manages this.");
  });

  it("the Principal reads teaching by teacher: subjects and classes, and the class each leads (D-104)", () => {
    const cls = (id: string, label: string) => ({ id, yearId: "y", programmeId: "p", programmeName: "Science", sectionKey: "plus2", levelId: "l", levelName: "Grade 11", label, active: true, canDelete: false });
    const ram = { id: "t1", fullName: "Ram Sah" };
    const gita = { id: "t2", fullName: "Gita Rai" };
    const teaching = (classId: string, classTeacher: typeof ram | null, assignments: { subjectName: string; teacher: typeof ram | null }[]) => ({
      classId,
      classLabel: "",
      levelName: "Grade 11",
      classTeacher,
      assignments: assignments.map((a, i) => ({ offeringId: `${classId}-${i}`, ...a })),
      teachers: [],
    });
    const { teachers, unassigned } = byTeacher(
      [cls("a", "A"), cls("b", "B")],
      [teaching("a", ram, [{ subjectName: "Physics", teacher: ram }, { subjectName: "English", teacher: gita }]), teaching("b", null, [{ subjectName: "Physics", teacher: ram }, { subjectName: "Nepali", teacher: null }])],
    );
    expect(teachers).toEqual([
      { id: "t2", name: "Gita Rai", teaches: ["English in Science · Grade 11 (A)"], classTeacherOf: [] },
      { id: "t1", name: "Ram Sah", teaches: ["Physics in Science · Grade 11 (A)", "Physics in Science · Grade 11 (B)"], classTeacherOf: ["Science · Grade 11 (A)"] },
    ]);
    expect(unassigned).toBe(1);
    const html = inContext(<TeachersTable teachers={teachers} />, as("admin", "institution"));
    expect(html).toContain(">No class<");
    expect(html).not.toMatch(/<(select|input|button)/);
  });
});
