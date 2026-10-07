import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MATRIX, ROLE_OF, type RoleCode } from "../../api/src/core/permissions/matrix"; // the one place permissions are decided
import { t } from "@/i18n/messages";
import { startYearId } from "@/setup/model";
import { SEARCH_ACCESS, groupsFor, matches, placeholderFor, seesAllStaff, studentHref } from "@/shell/search-model";
import { TermPicker, TermSelect } from "@/shell/TermChoice";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const as = (...roles: string[]) => roles.map((role) => ({ role }));

/** D-127: search finds only what a person can already read; the term picker changes what a page shows, not who sees what. */
describe("who searches what", () => {
  it("each group is searched only by roles the permission matrix lets read it (teachers deliberately not students: they cannot open a record)", () => {
    for (const [group, access] of Object.entries(SEARCH_ACCESS)) {
      const row = MATRIX.find((r) => r.id === access.action);
      expect(row, access.action).toBeDefined();
      const allowed = (Object.keys(row!.cells) as RoleCode[]).map((code) => ROLE_OF[code]);
      for (const role of access.roles) expect(allowed, `${group}: ${role}`).toContain(role);
      const leftOut = allowed.filter((role) => !(access.roles as readonly string[]).includes(role));
      expect(leftOut, group).toEqual(group === "students" ? ["teacher"] : []);
    }
  });

  it("a student finds only the pages of their own menu", () => {
    expect(groupsFor(as("student"))).toEqual(["pages"]);
  });

  it("a teacher finds pages and their own classes; an accountant pages and students", () => {
    expect(groupsFor(as("teacher"))).toEqual(["pages", "classes"]);
    expect(groupsFor(as("accountant"))).toEqual(["pages", "students"]);
  });

  it("the Co-ordinator and the Principal find everything; only the Principal sees the office staff", () => {
    expect(groupsFor(as("coordinator"))).toEqual(["pages", "classes", "students", "staff", "subjects"]);
    expect(groupsFor(as("admin"))).toEqual(["pages", "classes", "students", "staff", "subjects"]);
    expect(seesAllStaff(as("coordinator"))).toBe(false);
    expect(seesAllStaff(as("admin"))).toBe(true);
  });

  it("a student found by the Accountant opens their fees account; by anyone else, their record", () => {
    expect(studentHref(as("accountant"), "s1")).toBe("/portal/fees/student?id=s1");
    expect(studentHref(as("coordinator"), "s1")).toBe("/portal/admissions/student?id=s1");
  });
});

describe("what the field says it searches", () => {
  it("names only what this person can find", () => {
    expect(placeholderFor(groupsFor(as("student")))).toBe("search.placeholder.pages");
    expect(placeholderFor(groupsFor(as("teacher")))).toBe("search.placeholder.classes");
    expect(placeholderFor(groupsFor(as("accountant")))).toBe("search.placeholder.students");
    expect(placeholderFor(groupsFor(as("coordinator")))).toBe("search.placeholder.all");
  });
});

describe("how a result matches", () => {
  it("every word typed, in any order and case, ignoring accents", () => {
    expect(matches("grade 11", "Science", "Grade 11", "A")).toBe(true);
    expect(matches("11 SCIENCE", "Science", "Grade 11")).toBe(true);
    expect(matches("sita", "Sītā Sharma")).toBe(true);
    expect(matches("grade 12", "Science", "Grade 11")).toBe(false);
    expect(matches("   ", "anything")).toBe(false);
  });
});

describe("the term picker", () => {
  const terms = [
    { id: "t1", label: "2083 · +2" },
    { id: "t2", label: "BBS Semester 1" },
  ];

  it("offers every open term and 'All open terms', in one named select", () => {
    const html = renderToStaticMarkup(<TermSelect terms={terms} choice={null} onChoose={() => {}} />);
    expect(html).toContain("<select");
    expect(html).toContain(t("termPick.label"));
    expect(html).toContain(t("termPick.all"));
    expect(html.match(/<option/g)).toHaveLength(3);
  });

  it("is not shown outside its provider, or while no page uses it", () => {
    expect(renderToStaticMarkup(<TermPicker />)).toBe("");
  });

  it("a one-term page starts on the remembered term when it is one of its terms, else on the current one", () => {
    const years = [
      { id: "new", status: "draft" },
      { id: "now", status: "active" },
    ] as never;
    expect(startYearId(years, "new")).toBe("new");
    expect(startYearId(years, "gone")).toBe("now");
    expect(startYearId(years, null)).toBe("now");
  });
});
