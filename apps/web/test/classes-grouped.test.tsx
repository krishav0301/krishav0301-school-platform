import { describe, expect, it } from "vitest";

import { bareSection, classFilterOptions, groupClasses, nextClassFilters, NO_CLASS_FILTERS, NO_SECTION, sectionBadge, type ClassHubItem } from "@/classes/model";

/**
 * The grouped Classes page (PM, 2026-10-06): course > level > sections, the course and level named once, never
 * "Wing - Course - Level - Section" on every row; filters that narrow from wing to section.
 */
const cls = (id: string, course: string, level: string, section: string, over: Partial<ClassHubItem> = {}): ClassHubItem => ({
  id,
  termId: "t1",
  termLabel: "2083",
  wing: "Bachelor of Engineering",
  courseId: course.toLowerCase().replace(/\W+/g, "-"),
  course,
  levelId: `${course}-${level}`,
  level,
  section,
  classTeacher: null,
  classTeacherId: null,
  students: 0,
  isClassTeacher: false,
  ...over,
});

const classes: ClassHubItem[] = [
  cls("k1", "Computer Science", "2nd Semester", "A", { students: 3, classTeacher: "Hari", classTeacherId: "u1" }),
  cls("k2", "Computer Science", "2nd Semester", "Evening"),
  cls("k3", "Computer Science", "4th Semester", "Evening", { students: 2 }),
  cls("k4", "Information Science", "4th Semester", "Morning", { students: 1 }),
  cls("k5", "Mathematics", "11th Std", "A", { wing: "High School" }),
  cls("k6", "Mathematics", "11th Std", "", { wing: "High School" }),
];

describe("grouping", () => {
  it("one group per course, its levels once inside, its sections under each level, in the server's order", () => {
    const groups = groupClasses(classes, NO_CLASS_FILTERS);
    expect(groups.map((g) => g.name)).toEqual(["Computer Science", "Information Science", "Mathematics"]);
    const cs = groups[0]!;
    expect(cs.wing).toBe("Bachelor of Engineering");
    expect(cs.levels.map((l) => [l.name, l.classes.map((c) => c.section)])).toEqual([
      ["2nd Semester", ["A", "Evening"]],
      ["4th Semester", ["Evening"]],
    ]);
  });

  it("counts each course's sections, students and classes with no Class Teacher, and each level's students", () => {
    const cs = groupClasses(classes, NO_CLASS_FILTERS)[0]!;
    expect(cs).toMatchObject({ sections: 3, students: 5, unassigned: 2 });
    expect(cs.levels.map((l) => l.students)).toEqual([3, 2]);
  });
});

describe("filters", () => {
  it("narrow by wing, course, level and section; a class with no section is its own choice", () => {
    expect(groupClasses(classes, { ...NO_CLASS_FILTERS, wing: "High School" }).map((g) => g.name)).toEqual(["Mathematics"]);
    expect(groupClasses(classes, { ...NO_CLASS_FILTERS, course: "information-science" }).map((g) => g.name)).toEqual(["Information Science"]);
    const evening = groupClasses(classes, { ...NO_CLASS_FILTERS, section: "Evening" });
    expect(evening.flatMap((g) => g.levels.flatMap((l) => l.classes.map((c) => c.id)))).toEqual(["k2", "k3"]);
    expect(groupClasses(classes, { ...NO_CLASS_FILTERS, section: NO_SECTION }).flatMap((g) => g.levels.flatMap((l) => l.classes.map((c) => c.id)))).toEqual(["k6"]);
  });

  it("search finds a course, level, section or Class Teacher, whatever the case", () => {
    const ids = (q: string) => groupClasses(classes, { ...NO_CLASS_FILTERS, q }).flatMap((g) => g.levels.flatMap((l) => l.classes.map((c) => c.id)));
    expect(ids("4th")).toEqual(["k3", "k4"]);
    expect(ids("hari")).toEqual(["k1"]);
    expect(ids("MORNING")).toEqual(["k4"]);
    expect(ids("nothing like this")).toEqual([]);
  });

  it("each list offers what is left under the choices above it", () => {
    const all = classFilterOptions(classes, NO_CLASS_FILTERS);
    expect(all.wings).toEqual(["Bachelor of Engineering", "High School"]);
    expect(all.courses.map((c) => c.name)).toEqual(["Computer Science", "Information Science", "Mathematics"]);
    const be = classFilterOptions(classes, { ...NO_CLASS_FILTERS, wing: "Bachelor of Engineering" });
    expect(be.courses.map((c) => c.name)).toEqual(["Computer Science", "Information Science"]);
    const cs = classFilterOptions(classes, { ...NO_CLASS_FILTERS, course: "computer-science" });
    expect(cs.levels.map((l) => l.name)).toEqual(["2nd Semester", "4th Semester"]);
    expect(cs.sections).toEqual(["A", "Evening"]);
  });

  it("a changed choice clears the ones under it, and keeps the search", () => {
    const full = { q: "x", wing: "w", course: "c", level: "l", section: "s" };
    expect(nextClassFilters(full, { wing: "w2" })).toEqual({ q: "x", wing: "w2", course: "", level: "", section: "" });
    expect(nextClassFilters(full, { course: "c2" })).toEqual({ ...full, course: "c2", level: "", section: "" });
    expect(nextClassFilters(full, { level: "l2" })).toEqual({ ...full, level: "l2", section: "" });
    expect(nextClassFilters(full, { section: "s2" })).toEqual({ ...full, section: "s2" });
  });
});

describe("the section badge", () => {
  it("is the section's first letter, or a dash when the class has no section", () => {
    expect(sectionBadge("Evening")).toBe("E");
    expect(sectionBadge("a")).toBe("A");
    expect(sectionBadge("")).toBe("–");
  });
});

describe("a section typed with its word", () => {
  it("drops a typed Section or Sec, so the page never says Section Section B; the badge is the section's own letter", () => {
    expect(bareSection("Section B")).toBe("B");
    expect(bareSection("Sec A")).toBe("A");
    expect(bareSection("sec. C")).toBe("C");
    expect(bareSection("Evening")).toBe("Evening");
    expect(bareSection("Section")).toBe("Section"); // nothing after it: keep it as typed
    expect(sectionBadge("Section B")).toBe("B");
  });
});
