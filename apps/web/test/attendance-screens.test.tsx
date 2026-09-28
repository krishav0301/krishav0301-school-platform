import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AttendanceScreen } from "@/attendance/AttendanceScreen";
import { OwnAttendanceCard } from "@/attendance/OwnAttendanceCard";
import { Register } from "@/attendance/Register";
import { AttendanceTabs } from "@/attendance/AttendanceTabs";
import { OwnMonthScreen } from "@/attendance/OwnMonthScreen";
import { TeacherDayScreen } from "@/attendance/TeacherDayScreen";
import { className, counts, exceptionsOf, initialAbsent, initialStatuses, shiftMonth, studentMeta, type AttendanceDay, type TeacherDay } from "@/attendance/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { MoreScreen } from "@/shell/MoreScreen";
import { PortalShell } from "@/shell/PortalShell";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/attendance", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: { attendance: true, teacher_attendance: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section" | "own" | "assigned" = "institution") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("teacher", "assigned")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const day = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
  class: { id: "c1", programmeName: "Science", levelName: "Grade 11", label: "Morning", sectionKey: "plus2" },
  date: "2026-09-28",
  dateBs: "2083-06-12",
  isToday: true,
  marked: false,
  canMark: true,
  students: [
    { enrollmentId: "e1", sid: "2083-00001", name: "Sita Sharma", rollNo: 1, status: null },
    { enrollmentId: "e2", sid: "2083-00002", name: "Hari Yadav", rollNo: null, status: null },
  ],
  ...over,
});

describe("the attendance model", () => {
  it("names a class with its label only when it has one", () => {
    expect(className({ programmeName: "Science", levelName: "Grade 11", label: "" })).toBe("Science · Grade 11");
    expect(className({ programmeName: "Science", levelName: "Grade 11", label: "Morning" })).toBe("Science · Grade 11 · Morning");
  });

  it("shows the roll number only when there is one", () => {
    expect(studentMeta({ sid: "2083-00001", rollNo: 4 })).toBe("Roll 4 · 2083-00001");
    expect(studentMeta({ sid: "2083-00001", rollNo: null })).toBe("2083-00001");
  });

  it("starts everyone present, or from what was saved today", () => {
    expect([...initialAbsent(day())]).toEqual([]);
    const saved = day({ marked: true, students: day().students.map((s, i) => ({ ...s, status: i === 1 ? "absent" : "present" })) });
    expect([...initialAbsent(saved)]).toEqual(["e2"]);
  });

  it("counts present and absent from the absent set", () => {
    expect(counts(day(), new Set(["e2"]))).toEqual({ present: 1, absent: 1 });
    expect(counts(day(), new Set())).toEqual({ present: 2, absent: 0 });
  });
});

describe("the register", () => {
  it("lists every student under one 'Absent today' group, unticked, a live count, and one Save", () => {
    const html = inContext(<Register day={day()} />);
    expect(html).toContain("Today&#x27;s register");
    expect(html).toContain("Science · Grade 11 · Morning");
    expect(html).toContain("Today, 2083-06-12");
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Absent today<\/legend>/);
    expect(html).toContain("Sita Sharma");
    expect(html).toContain("Roll 1 · 2083-00001");
    expect(html).not.toContain("checked");
    expect(html).toContain("2 present, 0 absent");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Save register");
  });

  it("says when today was already saved, with the saved absences ticked", () => {
    const saved = day({ marked: true, students: day().students.map((s, i) => ({ ...s, status: i === 1 ? "absent" : "present" })) });
    const html = inContext(<Register day={saved} />);
    expect(html).toContain("Already saved today");
    expect(html).toContain("1 present, 1 absent");
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it("an empty class has nothing to save", () => {
    const html = inContext(<Register day={day({ students: [] })} />);
    expect(html).toContain("No students are enrolled in this class yet.");
    expect(html).not.toContain("<button");
  });
});

describe("loading", () => {
  it("the attendance screen and the student's card show the shape of the page while they load, not a lone spinner", () => {
    expect(inContext(<AttendanceScreen />)).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(inContext(<OwnAttendanceCard />, as("student", "own"))).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});

describe("the More tab", () => {
  it("a Co-ordinator's phone tab bar holds four places and More; the sidebar keeps all seven", () => {
    const html = inContext(
      <PortalShell>
        <h1>x</h1>
      </PortalShell>,
      as("coordinator"),
    );
    expect(html).toContain('href="/portal/more"');
    expect(html).toContain(">More<");
    // Setup and People are still in the markup, for the sidebar, but marked to hide on a phone.
    expect(html).toContain('class="navLink overflow" href="/portal/setup"');
    expect(html).toContain('class="navLink overflow" href="/portal/people"');
    expect(html).toContain('class="navLink overflow" href="/portal/content"');
    expect(html).toContain('class="navLink" aria-current="page" href="/portal/attendance"');
  });

  it("a role whose places all fit has no More", () => {
    const html = inContext(
      <PortalShell>
        <h1>x</h1>
      </PortalShell>,
      as("teacher", "assigned"),
    );
    expect(html).not.toContain("/portal/more");
  });

  it("the More list holds exactly the places that did not fit", () => {
    const html = inContext(<MoreScreen />, as("coordinator"));
    expect(html).toContain('href="/portal/setup"');
    expect(html).toContain('href="/portal/people"');
    expect(html).not.toContain('href="/portal/attendance"');
  });
});

describe("teacher attendance", () => {
  const teacherDay: TeacherDay = {
    date: "2026-09-28",
    dateBs: "2083-06-12",
    isToday: true,
    marked: false,
    teachers: [
      { id: "t1", name: "Ram Thapa", sectionKey: "plus2", status: null, reason: null },
      { id: "t2", name: "Gita Rai", sectionKey: "plus2", status: "leave", reason: null },
    ],
  };

  it("starts anyone unmarked as Present and sends only the exceptions", () => {
    const statuses = initialStatuses(teacherDay);
    expect(statuses).toEqual({ t1: "present", t2: "leave" });
    expect(exceptionsOf(statuses)).toEqual([{ teacherId: "t2", status: "leave" }]);
  });

  it("moves a BS month across a year boundary", () => {
    expect(shiftMonth("2083-12", 1)).toBe("2084-01");
    expect(shiftMonth("2083-01", -1)).toBe("2082-12");
    expect(shiftMonth("2083-06", 0)).toBe("2083-06");
  });

  it("the Co-ordinator gets Students and Teachers tabs; a teacher gets Students and My attendance; the Admin looks", () => {
    const tabs = (role: string, scope: "institution" | "assigned") => inContext(<AttendanceTabs pathname="/portal/attendance/teachers" />, as(role, scope));
    const coordinator = tabs("coordinator", "institution");
    expect(coordinator).toContain("/portal/attendance/teachers");
    expect(coordinator).not.toContain("/portal/attendance/mine");
    expect(coordinator).toContain('aria-current="page" href="/portal/attendance/teachers"');
    const teacher = tabs("teacher", "assigned");
    expect(teacher).toContain("/portal/attendance/mine");
    expect(teacher).not.toContain("/portal/attendance/teachers");
    expect(tabs("admin", "institution")).toContain("/portal/attendance/teachers");
  });

  it("the teacher and own-month screens show the shape of the page while they load", () => {
    expect(inContext(<TeacherDayScreen />, as("coordinator"))).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(inContext(<OwnMonthScreen />)).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});
