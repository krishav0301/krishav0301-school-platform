import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AccountantDashboard, DayList, OwnClassPanel, StudentDashboard, TeacherDashboard, feesFigures, feesRows, studyFigures, studyRows, teachingFigures, teachingRows, type TeachingDay } from "@/dashboard/RoleDashboards";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { attendance: true, teacher_attendance: true, homework: true, notes: true },
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

describe("the Teacher's, Student's and Accountant's homes (D-107)", () => {
  it("each greets at once and shows the shape of its figures while it loads", () => {
    for (const [node, session] of [
      [<TeacherDashboard key="t" />, as("teacher", "assigned")],
      [<StudentDashboard key="s" />, as("student", "own")],
      [<AccountantDashboard key="a" />, as("accountant", "institution")],
    ] as const) {
      const html = inContext(node, session);
      expect(html).toMatch(/<h1[^>]*>Good (morning|afternoon|evening), Asha</);
      expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
      expect(html).toContain("What you can do as");
    }
  });

  it("a row is a fact, its state in words and the page to act on it; with nothing to do, it says so", () => {
    const html = inContext(<DayList rows={[{ key: "a", title: "Register · Science", meta: "Today's register is not marked yet", todo: true, href: "/portal/attendance", action: "Mark register" }]} />);
    expect(html).toContain("Today&#x27;s register is not marked yet");
    expect(html).toContain('href="/portal/attendance"');
    expect(html).toContain('aria-label="Mark register: Register · Science"');
    expect(html).toMatch(/data-tone="warn"[^>]*>To do</);
    expect(inContext(<DayList rows={[]} />)).toContain("Nothing needs you right now.");
  });

  it("a teacher's day: their register, the log, homework to review, drafts; parts they have no share in are left out", () => {
    const day: TeachingDay = { todayBs: "2083-06-17", registers: [{ id: "c1", name: "+2 Science · Grade 12 · A", marked: false, absent: 0 }], logs: { written: 1, total: 3 }, toReview: 2, drafts: 0 };
    expect(teachingFigures(day).map((f) => f.value)).toEqual(["0 of 1", "1 of 3", "2", "0"]);
    const rows = teachingRows(day);
    expect(rows.map((r) => r.key)).toEqual(["register-c1", "logs", "homework", "marks"]);
    expect(rows.map((r) => r.todo)).toEqual([true, true, true, false]);
    const subjectTeacher = { ...day, registers: null, toReview: null, drafts: null };
    expect(teachingRows(subjectTeacher).map((r) => r.key)).toEqual(["logs"]);
    expect(teachingFigures(subjectTeacher)).toHaveLength(1);
  });

  it("a student's studies: attendance, homework, fees and the latest result, each only when there is one", () => {
    const own = { yearLabel: "2083", threshold: 75, present: 30, absent: 12, percent: 71, below: true, absentDays: [] };
    const full = { record: null, cls: null, attendance: own, homework: { open: 2, nextDue: "22 Ashwin 2083" }, latestLog: "17 Ashwin 2083", fees: { duePaisa: 2_250_000, overduePaisa: 150_000, balancePaisa: 2_250_000, chargedPaisa: 4_250_000 }, result: { terminal: "First terminal", score: "3.20" } };
    expect(studyFigures(full).map((f) => f.value)).toEqual(["71%", "2", "NPR 22,500", "3.20"]);
    expect(studyFigures(full)[0]!.tone).toBe("bad");
    const rows = studyRows(full);
    expect(rows.map((r) => r.key)).toEqual(["homework", "attendance", "log", "fees", "result"]);
    expect(rows[0]!.meta).toBe("2 to hand in · next due 22 Ashwin 2083");
    expect(rows[3]!.meta).toBe("NPR 1,500 overdue");
    expect(studyRows({ record: null, cls: null, attendance: null, homework: null, latestLog: null, fees: null, result: null })).toEqual([]);
  });

  it("the Accountant's day: deposits to check, students overdue, what is due, structures waiting", () => {
    const day = { vouchers: 1, overdue: { students: 3, paisa: 450_000 }, duePaisa: 6_000_000, structures: { draft: 1, waiting: 0, live: 2 } };
    expect(feesFigures(day).map((f) => f.value)).toEqual(["1", "3", "NPR 60,000", "0"]);
    const rows = feesRows(day);
    expect(rows.map((r) => [r.key, r.todo])).toEqual([["vouchers", true], ["overdue", true], ["structures", true]]);
    expect(rows[1]!.meta).toBe("3 students owe NPR 4,500 past the due day");
    expect(rows[2]!.meta).toBe("2 live, 0 waiting for approval, 1 drafts");
  });
});

describe("the student's own class (FUT point 18)", () => {
  const cls = {
    termLabel: "2083",
    wing: "+2",
    course: "Science",
    level: "Grade 11",
    section: "A",
    classTeacher: "Hari Prasad",
    subjects: [
      { name: "English", teacher: "Sita Sharma", elective: null },
      { name: "Physics", teacher: null, elective: null },
      { name: "Biology", teacher: "Ram Yadav", elective: "Science option" },
    ],
    electivesToChoose: [{ group: "Language option", options: ["Nepali", "Maithili"] }],
  };

  it("says where the class sits, its Class Teacher, and each subject with who teaches it", () => {
    const html = inContext(<OwnClassPanel cls={cls} />, as("student", "own"));
    expect(html).toContain("+2 · Science · Grade 11 · Section A");
    expect(html).toContain("Hari Prasad");
    expect(html).toMatch(/English[\s\S]*Sita Sharma/);
    expect(html).toContain("No teacher yet");
    expect(html).toMatch(/Biology[\s\S]*Science option/);
    expect(html).toContain("Language option: choose from Nepali, Maithili");
  });

  it("a class with no section and no Class Teacher says so plainly", () => {
    const html = inContext(<OwnClassPanel cls={{ ...cls, section: "", classTeacher: null, electivesToChoose: [] }} />, as("student", "own"));
    expect(html).toContain("+2 · Science · Grade 11<");
    expect(html).toContain("Not assigned yet");
  });
});
