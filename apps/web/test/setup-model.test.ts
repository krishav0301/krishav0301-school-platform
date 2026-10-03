import { describe, expect, it } from "vitest";

import {
  REASON_MESSAGE,
  canManageInstitution,
  canManageProgrammes,
  canManageStructure,
  classTitle,
  defaultYearId,
  emptyYearForm,
  isReceiptCode,
  suggestReceiptCode,
  levelChoices,
  manageableSections,
  termWords,
  validateYearForm,
  type Programme,
  type SchoolClass,
  type Year,
} from "@/setup/model";

const role = (r: string, scope: string, section?: string) => ({ role: r, scope, ...(section ? { section } : {}) });
const year = (id: string, status: Year["status"]): Year => ({ id, bsYear: 2083, label: id, startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", status });

describe("who sees the change controls (tidiness only; the API decides)", () => {
  it("the Co-ordinator and the Super Admin may change the structure; nobody else", () => {
    expect(canManageStructure([role("coordinator", "institution")])).toBe(true);
    expect(canManageStructure([role("coordinator", "section", "plus2")])).toBe(true);
    expect(canManageStructure([role("super_admin", "institution")])).toBe(true);
    for (const other of ["admin", "accountant", "teacher", "student"]) expect(canManageStructure([role(other, "institution")]), other).toBe(false);
    expect(canManageStructure([])).toBe(false);
  });

  it("programmes and their levels: the Admin and the Super Admin, never a Co-ordinator (D-087)", () => {
    expect(canManageProgrammes([role("admin", "institution")])).toBe(true);
    expect(canManageProgrammes([role("super_admin", "institution")])).toBe(true);
    for (const other of ["coordinator", "accountant", "teacher", "student"]) expect(canManageProgrammes([role(other, "institution")]), other).toBe(false);
    expect(canManageProgrammes([role("coordinator", "section", "plus2")])).toBe(false);
  });

  it("years and terminals need a whole-school Co-ordinator (or the Super Admin)", () => {
    expect(canManageInstitution([role("coordinator", "institution")])).toBe(true);
    expect(canManageInstitution([role("super_admin", "institution")])).toBe(true);
    expect(canManageInstitution([role("coordinator", "section", "plus2")])).toBe(false);
    expect(canManageInstitution([role("admin", "institution")])).toBe(false);
  });

  it("a section-scoped Co-ordinator may add programmes only to their own section", () => {
    const sections = [{ key: "plus2", name: "+2" }, { key: "bachelors", name: "Bachelor's" }];
    expect(manageableSections([role("coordinator", "institution")], sections)).toEqual(sections);
    expect(manageableSections([role("coordinator", "section", "plus2")], sections)).toEqual([sections[0]]);
    expect(manageableSections([role("admin", "institution")], sections)).toEqual([]);
  });
});

describe("defaultYearId", () => {
  it("is the active year, else the newest (the API lists newest first), else nothing", () => {
    expect(defaultYearId([year("new", "draft"), year("current", "active"), year("old", "closed")])).toBe("current");
    expect(defaultYearId([year("new", "draft"), year("old", "closed")])).toBe("new");
    expect(defaultYearId([])).toBeNull();
  });
});

describe("levelChoices", () => {
  const programmes: Programme[] = [
    { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true, students: 0, canDelete: false }, { id: "l2", ordinal: 2, name: "Year 2", active: false, students: 0, canDelete: false }] },
    { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true, students: 0, canDelete: false }] },
  ];
  it("lists only the active levels of active programmes, named with their programme", () => {
    expect(levelChoices(programmes)).toEqual([{ value: "l1", label: "BBS · Year 1" }]);
  });
});

describe("classTitle", () => {
  const base: SchoolClass = { id: "c", yearId: "y", programmeId: "p", programmeName: "BBS", sectionKey: "bachelors", levelId: "l", levelName: "Year 1", label: "", active: true, canDelete: false };
  it("reads programme and level, and the label in brackets when there is one", () => {
    expect(classTitle(base)).toBe("BBS · Year 1");
    expect(classTitle({ ...base, label: "Morning" })).toBe("BBS · Year 1 (Morning)");
  });
});

describe("validateYearForm", () => {
  it("wants a four-digit year and both days", () => {
    expect(validateYearForm(emptyYearForm())).toEqual({ bsYear: "setup.error.bsYear", startBs: "setup.error.startRequired", endBs: "setup.error.endRequired" });
    expect(validateYearForm({ bsYear: "20x3", startBs: "2083-01-01", endBs: "2083-12-30" })).toEqual({ bsYear: "setup.error.bsYear" });
    expect(validateYearForm({ bsYear: " 2083 ", startBs: "2083-01-01", endBs: "2083-12-30" })).toEqual({});
  });
});

describe("words", () => {
  it("every failure reason has words", () => {
    for (const reason of ["forbidden", "not_found", "conflict", "year_closed", "another_active", "rejected", "failed"] as const) expect(REASON_MESSAGE[reason]).toMatch(/^setup\.error\./);
  });

  it("the school's own words for programme, level, section and terminal come from its configuration", () => {
    const term = (key: string) => ({ "term.terminal": "Exam" })[key as "term.terminal"] ?? key;
    expect(termWords(term)).toEqual({ programme: "term.programme", level: "term.level", section: "term.section", terminal: "Exam" });
  });
});

describe("a section's receipt code (D-102, admin FUT F-18)", () => {
  it("is suggested from the name the way the server makes one", () => {
    expect(suggestReceiptCode("Master's Degrees")).toBe("MD");
    expect(suggestReceiptCode("Bachelor's")).toBe("BACH");
    expect(suggestReceiptCode("+2 (Grade 11-12)")).toBe("2G1112");
    expect(suggestReceiptCode("")).toBe("");
  });

  it("is 2 to 6 letters or digits", () => {
    for (const ok of ["P2", "bach", "ABC123"]) expect(isReceiptCode(ok), ok).toBe(true);
    for (const bad of ["P", "TOOLONG", "P-2", ""]) expect(isReceiptCode(bad), bad).toBe(false);
  });
});
