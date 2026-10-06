import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ClassesBrowser, SectionRow } from "@/classes/ClassesBrowser";
import { ClassResults, StudentsTable } from "@/classes/ClassesScreen";
import { classPlace, classTabs, pickTab, type ClassHub } from "@/classes/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/classes", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// A class as one page (FUT point 19, D-116): what each person sees of a class, from what the API sent.
const config = { school: { name: "School" }, sections: [], modules: {}, terms: { "term.classSection": "Section", "role.coordinator": "Co-ordinator" } } as unknown as PublicConfig;
const inContext = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { name: "Someone", roles: [{ role: "teacher", scope: "assigned" }] } })}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const place = { id: "c1", termId: "t1", termLabel: "2083", courseId: "co1", levelId: "l1", classTeacherId: "u1", wing: "+2", course: "Science", level: "Grade 11", section: "A", classTeacher: "Hari Prasad", students: 2 };
const subject = (offeringId: string, name: string) => ({ offeringId, name });
const hub = (over: Partial<ClassHub> = {}): ClassHub => ({
  class: place,
  viewer: { seesAll: true, attendance: true, isClassTeacher: true, staff: false },
  subjects: [subject("o1", "English"), subject("o2", "Chemistry")],
  mySubjects: [subject("o1", "English"), subject("o2", "Chemistry")],
  taughtSubjects: [],
  terminals: [{ id: "t1", name: "First terminal", published: false }],
  students: [
    { enrollmentId: "e1", rollNo: 1, name: "Sita Yadav", sid: "2083-00001", studentId: "s1" },
    { enrollmentId: "e2", rollNo: null, name: "Ram Shah", sid: "2083-00002", studentId: "s2" },
  ],
  ...over,
});

describe("the tabs each person sees (the PM's rules)", () => {
  it("a Class Teacher who teaches nothing here: Students, Attendance, Results; no Classwork (a teacher's classwork is their own subjects)", () => {
    expect(classTabs(hub())).toEqual(["students", "attendance", "results"]);
  });
  it("a subject teacher: Students, Classwork, Results; never Attendance", () => {
    expect(classTabs(hub({ viewer: { seesAll: false, attendance: false, isClassTeacher: false, staff: false }, taughtSubjects: [subject("o2", "Chemistry")] }))).toEqual(["students", "classwork", "results"]);
  });
  it("the Principal and the Co-ordinator: every tab", () => {
    expect(classTabs(hub({ viewer: { seesAll: true, attendance: true, isClassTeacher: false, staff: true } }))).toEqual(["students", "attendance", "classwork", "results"]);
  });
  it("a tab asked for in the address opens only if the person may see it", () => {
    expect(pickTab(["students", "results"], "attendance")).toBe("students");
    expect(pickTab(["students", "results"], "results")).toBe("results");
  });
});

describe("the class list, grouped (PM, 2026-10-06)", () => {
  const item = { ...place, termId: "t1", courseId: "co1", levelId: "l1", classTeacherId: "u1", isClassTeacher: false };
  const list = [
    { ...item, isClassTeacher: true },
    { ...item, id: "c2", section: "", classTeacher: null, classTeacherId: null },
    { ...item, id: "c3", courseId: "co2", course: "Management", levelId: "l2", section: "B", students: 5 },
  ];

  it("names the course and its wing once, the level once, and each section under it; never the whole place on a row", () => {
    const html = inContext(<ClassesBrowser classes={list} canManage={false} onChanged={() => {}} />);
    expect(html).toMatch(/<h2[^>]*>Science<\/h2>/);
    expect(html.split(">Grade 11</h3>").length - 1).toBe(1); // the level heading once, for both of its sections (only Science is open)
    expect(html).not.toContain("+2 · Science · Grade 11 · Section A</");
    expect(html).toContain(">Section A</a>");
    expect(html).toContain(">You<");
    expect(html).toContain("No Class Teacher yet");
  });

  it("opens the first course and keeps the others closed, each with a labelled button that says so", () => {
    const html = inContext(<ClassesBrowser classes={list} canManage={false} onChanged={() => {}} />);
    expect(html).toContain('aria-label="Hide Science"');
    expect(html).toContain('aria-label="Show Management"');
    expect(html).not.toContain(">Section B</a>"); // inside the closed course
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
  });

  it("counts each course's sections, students and classes with no Class Teacher", () => {
    const html = inContext(<ClassesBrowser classes={list} canManage={false} onChanged={() => {}} />);
    expect(html).toMatch(/<dt>Sections<\/dt><dd>2<\/dd>/);
    expect(html).toMatch(/<dt>No Class Teacher<\/dt><dd>1<\/dd>/);
  });

  it("offers the Co-ordinator Add Section on each level; nobody else", () => {
    expect(inContext(<ClassesBrowser classes={list} canManage onChanged={() => {}} />)).toContain(">Add Section<");
    expect(inContext(<ClassesBrowser classes={list} canManage={false} onChanged={() => {}} />)).not.toContain(">Add Section<");
  });

  it("each section opens its class, and its menu is labelled with where the class sits", () => {
    const html = inContext(<SectionRow cls={list[1]!} canManage onAct={() => {}} />);
    expect(html).toContain('href="/portal/classes/class?id=c2"');
    expect(html).toContain("No Section"); // a class with no section label
    expect(html).toContain('aria-label="Actions for +2 · Science · Grade 11"');
    expect(classPlace({ ...place, section: "" })).toBe("+2 · Science · Grade 11");
  });

  it("says so when there is no class to show", () => {
    expect(inContext(<ClassesBrowser classes={[]} canManage={false} onChanged={() => {}} />)).toContain("No class to show yet");
  });
});

describe("inside a class", () => {
  it("those who see the whole class get each student's SID; a subject teacher names only", () => {
    const all = inContext(<StudentsTable hub={hub()} canOpenRecord={false} />);
    expect(all).toContain("2083-00001");
    expect(all).toContain("Sita Yadav");
    const names = inContext(<StudentsTable hub={hub({ viewer: { seesAll: false, attendance: false, isClassTeacher: false, staff: false }, students: hub().students.map((s) => ({ ...s, sid: null, studentId: null })) })} canOpenRecord={false} />);
    expect(names).toContain("Sita Yadav");
    expect(names).not.toContain(">SID<");
    expect(names).not.toContain("Record");
  });
  it("the Co-ordinator and the Principal can open a student's record from the list", () => {
    expect(inContext(<StudentsTable hub={hub({ viewer: { seesAll: true, attendance: true, isClassTeacher: false, staff: true } })} canOpenRecord />)).toContain('href="/portal/admissions/student?id=s1"');
  });
  it("results: nothing published yet says who publishes; a subject teacher opens their own marks exam by exam", () => {
    expect(inContext(<ClassResults hub={hub()} />)).toContain("Results show here once the Co-ordinator publishes them.");
    const own = inContext(<ClassResults hub={hub({ viewer: { seesAll: false, attendance: false, isClassTeacher: false, staff: false }, mySubjects: [subject("o2", "Chemistry")] })} />);
    expect(own).toContain('href="/portal/results/sheet?class=c1&amp;subject=o2&amp;terminal=t1"');
    expect(own).not.toContain("English");
  });
});
