import { describe, expect, it } from "vitest";

import { filterMissing, filterTeachers, teachingBoard } from "@/people/teaching-board";
import type { ClassTeaching } from "@/people/teaching-model";
import type { SchoolClass } from "@/setup/model";

/** The Teaching page redesigned (PM, 2026-10-06, UI only): teacher, then subjects, classes and the class they lead, apart. */
const cls = (id: string, programmeName: string, levelName: string, label: string, yearId = "t1"): SchoolClass => ({ id, yearId, programmeId: programmeName, programmeName, sectionKey: "s", levelId: levelName, levelName, label, active: true, canDelete: false });
const harshitha = { id: "u1", fullName: "Harshitha" };
const namish = { id: "u2", fullName: "Namish" };
const teaching = (classId: string, assignments: [string, typeof harshitha | null][], classTeacher: typeof harshitha | null = null): ClassTeaching => ({
  classId,
  classLabel: "",
  levelName: "x",
  classTeacher,
  assignments: assignments.map(([subjectName, teacher], i) => ({ offeringId: `${classId}-o${i}`, subjectName, teacher })),
});

const classes = [cls("k1", "ISE", "4th Semester", "Evening"), cls("k2", "Maths", "11th Std", "Section A", "t2"), cls("k3", "Maths", "12th Std", "Section A", "t2")];
const teachings = [
  teaching("k1", [["Claude", harshitha], ["Networks", null]]),
  teaching("k2", [["Chemistry", namish], ["English", namish], ["Biology", null]]),
  teaching("k3", [["Chemistry", namish]], namish),
];

describe("the board", () => {
  it("gives each teacher their subjects once, the classes they teach once, and the class they lead, apart", () => {
    const { teachers } = teachingBoard(classes, teachings);
    expect(teachers.map((x) => x.name)).toEqual(["Harshitha", "Namish"]);
    const n = teachers[1]!;
    expect(n.subjects).toEqual([
      { subject: "Chemistry", course: "Maths" },
      { subject: "English", course: "Maths" },
    ]);
    expect(n.classes.map((c) => c.name)).toEqual(["11th Std (Section A)", "12th Std (Section A)"]);
    expect(n.classTeacherOf.map((c) => c.name)).toEqual(["12th Std (Section A)"]);
    expect(teachers[0]!.classTeacherOf).toEqual([]);
  });

  it("lists every subject still without a teacher, with its class", () => {
    expect(teachingBoard(classes, teachings).missing.map((m) => `${m.subject} · ${m.cls.name}`)).toEqual(["Networks · 4th Semester (Evening)", "Biology · 11th Std (Section A)"]);
  });

  it("counts teachers with work, subjects assigned of all, classes taught of all, and the subjects without a teacher", () => {
    expect(teachingBoard(classes, teachings).figures).toEqual({ teachers: 2, assigned: 4, subjects: 6, classesTaught: 3, classes: 3, missing: 2 });
  });

  it("narrows to one term", () => {
    const b = teachingBoard(classes, teachings, "t1");
    expect(b.teachers.map((x) => x.name)).toEqual(["Harshitha"]);
    expect(b.figures).toEqual({ teachers: 1, assigned: 1, subjects: 2, classesTaught: 1, classes: 1, missing: 1 });
  });
});

describe("filters", () => {
  const { teachers, missing } = teachingBoard(classes, teachings);
  it("search finds a teacher by name, subject or class; status keeps those who lead a class, or those who do not", () => {
    expect(filterTeachers(teachers, "claude", "").map((x) => x.name)).toEqual(["Harshitha"]);
    expect(filterTeachers(teachers, "12th", "").map((x) => x.name)).toEqual(["Namish"]);
    expect(filterTeachers(teachers, "", "lead").map((x) => x.name)).toEqual(["Namish"]);
    expect(filterTeachers(teachers, "", "notLead").map((x) => x.name)).toEqual(["Harshitha"]);
  });
  it("the missing list searches subject and class", () => {
    expect(filterMissing(missing, "bio").map((m) => m.subject)).toEqual(["Biology"]);
    expect(filterMissing(missing, "evening").map((m) => m.subject)).toEqual(["Networks"]);
  });
});

// --- Markup ---------------------------------------------------------------------------------------------------------------
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { TeacherCardView, TeachingBoardView } from "@/people/TeachingBoardView";

const config = { school: { name: "School" }, sections: [], modules: {}, terms: { "role.teacher": "Teacher" } } as unknown as PublicConfig;
const render = (node: React.ReactNode) => renderToStaticMarkup(<ConfigContext.Provider value={makeConfigValue("ready", config)}>{node}</ConfigContext.Provider>);
const data = { classes, teachings, terms: [{ id: "t1", label: "B.E. Odd" }, { id: "t2", label: "School 2083" }], emails: new Map([["u1", "harshitha@school.example"]]), allTeachers: 19 };

describe("the page, read only (PM: a UI redesign, no new actions)", () => {
  const html = render(<TeachingBoardView data={data} />);

  it("leads with the four figures; the last leads to the subjects without a teacher", () => {
    expect(html).toContain("out of 19 teachers");
    expect(html).toContain("out of 6 subjects");
    expect(html).toContain("out of 3 classes");
    expect(html).toMatch(/<a[^>]*href="#missing-teachers"[^>]*>/);
    expect(html).toContain('id="missing-teachers"');
  });

  it("shows each teacher's subjects, classes and Class Teacher apart, never as one sentence", () => {
    expect(html).toContain("Teachers with Teaching Assignments (2)");
    expect(html).toContain("Subjects (2)");
    expect(html).toContain(">11th Std (Section A)<");
    expect(html).toContain("Not a Class Teacher");
    expect(html).not.toContain(" in 11th Std");
    expect(html).toContain("harshitha@school.example");
  });

  it("lists the subjects without a teacher with their class and term, and offers no action the Principal cannot take", () => {
    expect(html).toContain("Subjects without Teacher (2)");
    expect(html).toContain(">Networks<");
    expect(html).toContain("School 2083");
    expect(html).not.toMatch(/Assign Teacher|Set as Class Teacher|Assign Teaching/);
  });

  it("starts as cards, with a pressed toggle for the table", () => {
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Cards/);
  });
});

describe("a teacher's card", () => {
  it("shows four subjects, then +n more", () => {
    const many = { id: "u9", name: "Namish Rai", subjects: ["Chemistry", "English", "Physics", "Python", "Maths"].map((subject) => ({ subject, course: "Maths" })), classes: [], classTeacherOf: [] };
    const html = render(<TeacherCardView teacher={many} email={null} />);
    expect(html).toContain("Subjects (5)");
    expect(html).toContain(">+1 more<");
    expect(html).not.toContain(">Maths</span><span");
    expect(html).toContain(">NR<");
  });
});
