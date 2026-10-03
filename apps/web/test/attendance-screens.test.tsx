import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AttendanceScreen, ClassesTable, attendanceFigures } from "@/attendance/AttendanceScreen";
import { DayTable, YearTable } from "@/attendance/ClassAttendanceScreen";
import { OwnAttendanceCard } from "@/attendance/OwnAttendanceCard";
import { Register } from "@/attendance/Register";
import { AttendanceTabs } from "@/attendance/AttendanceTabs";
import { OwnMonthScreen } from "@/attendance/OwnMonthScreen";
import { TeacherDayScreen, TeacherList, TeacherTable, teacherFigures } from "@/attendance/TeacherDayScreen";
import { className, counts, exceptionsOf, initialAbsent, initialStatuses, shiftMonth, studentMeta, type AttendanceDay, type TeacherDay } from "@/attendance/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { MoreScreen } from "@/shell/MoreScreen";
import { PortalShell } from "@/shell/PortalShell";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/attendance", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
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

// ---------------------------------------------------------------------------------------------
describe("the Principal reads attendance (D-103, after the PM's topic 7 reference)", () => {
  const cls = (id: string, markedToday: boolean, absentToday: number, classTeacher: string | null, students = 20) => ({
    id,
    programmeName: "+2 Science",
    levelName: "Grade 11",
    label: id.toUpperCase(),
    sectionKey: "plus2",
    students,
    markedToday,
    absentToday,
    classTeacher,
    mine: false,
  });
  const list = { today: "2026-10-03", todayBs: "2083-06-17", classes: [cls("a", true, 2, "Bikash Chaudhary"), cls("b", false, 0, null), cls("c", true, 0, "Puja Singh", 10)] };

  it("figures: present today of the classes marked, absent, classes not marked yet, teachers on leave", () => {
    const teachers = { date: "2026-10-03", dateBs: "2083-06-17", isToday: true, marked: true, teachers: [{ id: "t1", name: "Gita", sectionKey: null, status: "leave" as const, reason: null }] };
    const figures = attendanceFigures(list, teachers);
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ["Present today", "93%"],
      ["Absent today", "2"],
      ["Classes not marked yet", "1"],
      ["Teachers on leave", "1"],
    ]);
    expect(attendanceFigures(list, null)).toHaveLength(3);
  });

  it("every class with its Class Teacher and today's state in words, the unmarked first, each opening its register", () => {
    const html = inContext(<ClassesTable classes={list.classes} />, as("admin"));
    expect(html.indexOf("Grade 11 · B")).toBeLessThan(html.indexOf("Grade 11 · A"));
    expect(html).toContain("Bikash Chaudhary");
    expect(html).toContain("Not named yet");
    expect(html).toContain(">Not marked yet<");
    expect(html).toContain(">Marked<");
    expect(html).toContain("2 absent");
    expect(html).toContain('href="/portal/attendance/class?id=b"');
    expect(html).toContain('data-label="Class Teacher"'); // each value keeps its name when stacked on a phone
  });

  it("a day's register says Present and Absent in words, with no controls", () => {
    const marked = day({ marked: true, canMark: false });
    marked.students = [
      { ...marked.students[0]!, status: "present" },
      { ...marked.students[1]!, status: "absent" },
    ];
    const html = inContext(<DayTable day={marked} />, as("admin"));
    expect(html).toContain(">Absent<");
    expect(html).toContain(">Present<");
    expect(html).not.toMatch(/<input|<button/);
    expect(inContext(<DayTable day={day({ marked: false, canMark: false, isToday: true })} />, as("admin"))).toContain("Not marked yet today.");
  });

  it("the year so far flags below the threshold in words", () => {
    const summary = { class: day().class, threshold: 75, students: [{ enrollmentId: "e1", sid: "2083-00001", name: "Asha", rollNo: null, present: 6, absent: 4, percent: 60, below: true }] };
    const html = inContext(<YearTable summary={summary} />, as("admin"));
    expect(html).toContain("Below 75%");
    expect(html).toContain("6 of 10");
    expect(html).toContain("60%");
  });

  it("teacher attendance: status in words and the reason for a corrected day", () => {
    const tday = { date: "2026-10-03", dateBs: "2083-06-17", isToday: true, marked: true, teachers: [{ id: "t1", name: "Gita Thapa", sectionKey: null, status: "leave" as const, reason: "Personal leave" }] };
    const html = inContext(<TeacherTable day={tday} />, as("admin"));
    expect(html).toContain(">On leave<");
    expect(html).toContain("Personal leave");
    expect(html).not.toMatch(/<select|<button/);
  });
});

describe("the Co-ordinator's teacher list (D-106)", () => {
  const day = {
    date: "2026-10-03",
    dateBs: "2083-06-17",
    isToday: false,
    marked: false,
    teachers: [
      { id: "t1", name: "Gita Thapa", sectionKey: "plus2", status: "leave" as const, reason: null },
      { id: "t2", name: "Ram Karki", sectionKey: null, status: null, reason: null },
    ],
  };

  it("each teacher has Present, Absent and On leave side by side, the day's choice pressed; a past day asks for a reason", () => {
    const html = inContext(<TeacherList day={day} onSaved={() => {}} />, as("coordinator"));
    expect(html).toContain('aria-label="Attendance of Gita Thapa"');
    expect(html).toContain('aria-label="Attendance of Ram Karki"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>On leave</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Present</); // Ram starts as present
    expect(html).toContain(">Not saved yet<");
    expect(html).toContain("Reason for changing a past day");
    expect(html).not.toContain("<select");
  });

  it("the figures count the choices on screen", () => {
    expect(teacherFigures(5, [{ status: "absent" }, { status: "leave" }, { status: "leave" }]).map((f) => f.value)).toEqual(["2", "1", "2"]);
  });
});
