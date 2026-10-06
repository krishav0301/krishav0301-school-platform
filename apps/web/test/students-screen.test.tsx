import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StudentBrowse } from "@/admissions/client";
import { nextFilters, StudentFilters, StudentsTable, type Filters } from "@/admissions/StudentsScreen";

/** The Students page (PM, 2026-10-06): wing, then course, then level, then class, each offering only what has students. */

const lists: Pick<StudentBrowse, "wings" | "terms"> = {
  wings: [
    {
      key: "plus2",
      name: "+2",
      count: 5,
      courses: [{ id: "c1", name: "Science", count: 5, levels: [{ id: "l1", name: "Grade 11", count: 5, classes: [{ id: "k1", label: "Morning", count: 3 }, { id: "k2", label: "", count: 2 }] }] }],
    },
    { key: "bachelors", name: "Bachelor's", count: 2, courses: [{ id: "c2", name: "BBS", count: 2, levels: [{ id: "l2", name: "Year 1", count: 2, classes: [{ id: "k3", label: "", count: 2 }] }] }] },
  ],
  terms: [
    { id: "t1", label: "2083", open: true },
    { id: "t0", label: "2082", open: false },
  ],
};
const none: Filters = { q: "", term: "", status: "", wing: "", course: "", level: "", class: "" };
const render = (filters: Partial<Filters>) => renderToStaticMarkup(<StudentFilters filters={{ ...none, ...filters }} data={lists} onChange={() => {}} />);
const labels = (html: string) => [...html.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map((m) => m[1]);

describe("the filters", () => {
  it("start with the term, the status and the wings, each wing with its count", () => {
    const html = render({});
    expect(labels(html)).toEqual(["Term", "Status", "Wing"]);
    expect(html).toContain(">+2 (5)<");
    expect(html).toContain(">Bachelor&#x27;s (2)<");
    expect(html).toContain(">Open terms<");
    expect(html).toContain(">2082 (closed)<");
  });

  it("show each next list once the one before it is chosen, with only that choice's children", () => {
    expect(labels(render({ wing: "plus2" }))).toEqual(["Term", "Status", "Wing", "Course"]);
    expect(render({ wing: "plus2" })).not.toContain("BBS");
    expect(labels(render({ wing: "plus2", course: "c1" }))).toEqual(["Term", "Status", "Wing", "Course", "Level"]);
    const classes = render({ wing: "plus2", course: "c1", level: "l1" });
    expect(labels(classes)).toEqual(["Term", "Status", "Wing", "Course", "Level", "Class"]);
    expect(classes).toContain(">Morning (3)<");
    expect(classes).toContain(">Grade 11 (2)<"); // a class with no section label is called by its level
  });

  it("offer no wing list when nothing has students", () => {
    const html = renderToStaticMarkup(<StudentFilters filters={none} data={{ wings: [], terms: [] }} onChange={() => {}} />);
    expect(labels(html)).toEqual(["Term", "Status"]);
  });

  it("clear what is under a changed choice, and keep the search", () => {
    const full: Filters = { q: "sita", term: "t1", status: "", wing: "plus2", course: "c1", level: "l1", class: "k1" };
    expect(nextFilters(full, { level: "l9" })).toEqual({ ...full, level: "l9", class: "" });
    expect(nextFilters(full, { course: "c9" })).toEqual({ ...full, course: "c9", level: "", class: "" });
    expect(nextFilters(full, { wing: "bachelors" })).toEqual({ ...full, wing: "bachelors", course: "", level: "", class: "" });
    expect(nextFilters(full, { status: "left" })).toEqual({ ...full, status: "left", wing: "", course: "", level: "", class: "" });
    expect(nextFilters(full, { term: "t0" })).toEqual({ ...full, term: "t0", wing: "", course: "", level: "", class: "" });
    expect(nextFilters(full, { q: "ram" })).toEqual({ ...full, q: "ram" });
  });
});

describe("the list", () => {
  it("shows the name, SID, class, term, guardian's phone and status, and opens the record", () => {
    const html = renderToStaticMarkup(
      <StudentsTable
        students={[
          { id: "s1", sid: "2083-00012", firstName: "Sita", lastName: "Sharma", status: "active", guardianPhone: "9800000001", rollNo: 4, class: { id: "k1", label: "Morning", levelName: "Grade 11", courseName: "Science", wingName: "+2" }, term: { id: "t1", label: "2083" } },
          { id: "s2", sid: "2083-00013", firstName: "Gita", lastName: "Unplaced", status: "left", guardianPhone: "9811111111", rollNo: null, class: null, term: null },
        ]}
      />,
    );
    expect(html).toContain("Sita Sharma");
    expect(html).toContain("2083-00012");
    expect(html).toContain("Science · Grade 11");
    expect(html).toContain("+2 · Morning");
    expect(html).toContain("9800000001");
    expect(html).toContain("No class yet");
    expect(html).toContain(">Left<");
    expect(html).toContain('href="/portal/admissions/student?id=s1"');
    expect(html).toContain('aria-label="Open the record of Sita Sharma"');
  });
});
