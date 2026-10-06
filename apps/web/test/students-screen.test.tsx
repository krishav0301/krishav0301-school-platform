import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { StudentBrowse } from "@/admissions/client";
import { placeLine } from "@/admissions/StudentScreen";
import { nextFilters, StudentFilters, StudentsTable, type Filters } from "@/admissions/StudentsScreen";
import { setSchoolWords } from "@/i18n/messages";

/**
 * The Students page (PM, 2026-10-06): wing, course (a school may call it Department), level and class always on screen;
 * each list offers only what has students; level and class wait for the one before them.
 */

const lists: Pick<StudentBrowse, "wings" | "terms"> = {
  wings: [
    {
      key: "plus2",
      name: "+2",
      count: 5,
      courses: [{ id: "c1", name: "Science", count: 5, levels: [{ id: "l1", name: "Grade 11", count: 5, classes: [{ id: "k1", label: "Morning", count: 3 }, { id: "k2", label: "", count: 2 }] }] }],
    },
    {
      key: "be",
      name: "Bachelor of Engineering",
      count: 3,
      courses: [
        { id: "c2", name: "Information Science and Engineering", count: 2, levels: [{ id: "l2", name: "4th Semester", count: 2, classes: [{ id: "k3", label: "Evening", count: 2 }] }] },
        { id: "c3", name: "Science", count: 1, levels: [{ id: "l3", name: "Year 1", count: 1, classes: [{ id: "k4", label: "", count: 1 }] }] },
      ],
    },
  ],
  terms: [
    { id: "t1", label: "2083", open: true },
    { id: "t0", label: "2082", open: false },
  ],
};
const none: Filters = { q: "", term: "", status: "", wing: "", course: "", level: "", class: "" };
const render = (filters: Partial<Filters>, data = lists) => renderToStaticMarkup(<StudentFilters filters={{ ...none, ...filters }} data={data} onChange={() => {}} />);
const labels = (html: string) => [...html.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map((m) => m[1]);
const disabledSelects = (html: string) => (html.match(/<select[^>]*disabled/g) ?? []).length;

afterEach(() => setSchoolWords({}));

describe("the filters", () => {
  it("are all on screen from the start, in order, with level and class waiting for the one before them", () => {
    const html = render({});
    expect(labels(html)).toEqual(["Term", "Status", "Wing", "Course", "Level", "Class"]);
    expect(disabledSelects(html)).toBe(2);
    expect(html).toContain(">Choose a Course first<");
    expect(html).toContain(">Choose a Level first<");
    expect(html).toContain(">+2 (5)<");
    expect(html).toContain(">Open terms<");
    expect(html).toContain(">2082 (closed)<");
  });

  it("use the school's own word for a course: Department", () => {
    setSchoolWords({ programme: "Department" });
    const html = render({});
    expect(labels(html)).toEqual(["Term", "Status", "Wing", "Department", "Level", "Class"]);
    expect(html).toContain(">Choose a Department first<");
  });

  it("list every course before a wing is chosen, naming the wing where two share a name; then only that wing's", () => {
    const html = render({});
    expect(html).toContain(">Information Science and Engineering (2)<");
    expect(html).toContain(">Science · +2 (5)<");
    expect(html).toContain(">Science · Bachelor of Engineering (1)<");
    const be = render({ wing: "be" });
    expect(be).toContain(">Science (1)<");
    expect(be).not.toContain("+2 (5)</option><option value=\"c1\"");
    expect(be).not.toContain('value="c1"');
  });

  it("offer a course's levels, and a level's classes, once chosen; a course works without a wing", () => {
    const course = render({ course: "c2" });
    expect(course).toContain(">4th Semester (2)<");
    expect(disabledSelects(course)).toBe(1);
    const level = render({ course: "c2", level: "l2" });
    expect(level).toContain(">Evening (2)<");
    expect(disabledSelects(level)).toBe(0);
    expect(render({ wing: "plus2", course: "c1", level: "l1" })).toContain(">Grade 11 (2)<"); // a class with no section label is called by its level
  });

  it("show an empty wing list (just All) when nothing has students", () => {
    const html = render({}, { wings: [], terms: [] });
    expect(labels(html)).toEqual(["Term", "Status", "Wing", "Course", "Level", "Class"]);
  });

  it("clear what is under a changed choice, and keep the search", () => {
    const full: Filters = { q: "sita", term: "t1", status: "", wing: "plus2", course: "c1", level: "l1", class: "k1" };
    expect(nextFilters(full, { level: "l9" })).toEqual({ ...full, level: "l9", class: "" });
    expect(nextFilters(full, { course: "c9" })).toEqual({ ...full, course: "c9", level: "", class: "" });
    expect(nextFilters(full, { wing: "be" })).toEqual({ ...full, wing: "be", course: "", level: "", class: "" });
    expect(nextFilters(full, { status: "left" })).toEqual({ ...full, status: "left", wing: "", course: "", level: "", class: "" });
    expect(nextFilters(full, { term: "t0" })).toEqual({ ...full, term: "t0", wing: "", course: "", level: "", class: "" });
    expect(nextFilters(full, { q: "ram" })).toEqual({ ...full, q: "ram" });
  });
});

describe("the list", () => {
  it("shows the course (with its wing) in one column and the class as level and section in another", () => {
    setSchoolWords({ programme: "Department" });
    const html = renderToStaticMarkup(
      <StudentsTable
        students={[
          { id: "s1", sid: "2083-00012", firstName: "Sita", lastName: "Sharma", status: "active", guardianPhone: "9800000001", rollNo: 4, class: { id: "k3", label: "Evening", levelName: "4th Semester", courseName: "Information Science and Engineering", wingName: "Bachelor of Engineering" }, term: { id: "t1", label: "2083" } },
          { id: "s2", sid: "2083-00013", firstName: "Gita", lastName: "Unplaced", status: "left", guardianPhone: "9811111111", rollNo: null, class: null, term: null },
          { id: "s3", sid: "2083-00014", firstName: "Hari", lastName: "Sah", status: "active", guardianPhone: "9811111112", rollNo: null, class: { id: "k4", label: "", levelName: "Year 1", courseName: "Science", wingName: "Bachelor of Engineering" }, term: { id: "t1", label: "2083" } },
        ]}
      />,
    );
    expect(html).toContain(">Department</th>");
    expect(html).toContain(">Information Science and Engineering<");
    expect(html).toContain(">Bachelor of Engineering<");
    expect(html).toContain(">4th Semester – Evening<");
    expect(html).toContain(">Year 1<");
    expect(html).toContain("No class yet");
    expect(html).toContain(">Left<");
    expect(html).toContain('href="/portal/admissions/student?id=s1"');
    expect(html).toContain('aria-label="Open the record of Sita Sharma"');
  });
});

describe("the record's line under the name", () => {
  it("says the course, then the level and section", () => {
    expect(placeLine({ wing: "Bachelor of Engineering", course: "Information Science and Engineering", level: "4th Semester", section: "Evening", term: "2083" })).toBe("Information Science and Engineering, 4th Semester – Evening");
    expect(placeLine({ wing: "+2", course: "Science", level: "Grade 11", section: "", term: "2083" })).toBe("Science, Grade 11");
  });
});
