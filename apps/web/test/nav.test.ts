import { describe, expect, it } from "vitest";

import { MAX_TABS, NAV_ITEMS, isCurrent, showsMenu, splitNav, visibleNav, type NavItem } from "@/shell/nav";
import { ROLES } from "../../api/src/core/roles";

const items: NavItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", href: "/portal", icon: "overview" as const },
  { id: "fees", labelKey: "nav.dashboard", href: "/portal/fees", roles: ["accountant", "admin"], module: "fees", icon: "overview" as const },
  { id: "homework", labelKey: "nav.dashboard", href: "/portal/homework", roles: ["teacher", "student"], module: "homework", icon: "overview" as const },
];
const ids = (list: NavItem[]) => list.map((i) => i.id);

describe("isCurrent", () => {
  it("marks an entry current on its own page and on pages beneath it", () => {
    expect(isCurrent("/portal/content", "/portal/content")).toBe(true);
    expect(isCurrent("/portal/content/edit", "/portal/content")).toBe(true);
  });

  it("the dashboard is current only on itself, not on every portal page", () => {
    expect(isCurrent("/portal", "/portal")).toBe(true);
    expect(isCurrent("/portal/content", "/portal")).toBe(false);
  });

  it("does not confuse a page whose name merely starts the same", () => {
    expect(isCurrent("/portal/contents", "/portal/content")).toBe(false);
    expect(isCurrent("/portal/content-x/edit", "/portal/content")).toBe(false);
  });
});

describe("the real menu", () => {
  const seen = (role: string, scope: "institution" | "section" | "own" | "assigned", modules: Record<string, boolean> = { attendance: true }) =>
    visibleNav(NAV_ITEMS, [{ role, scope }], modules).map((i) => i.id);

  it("shows each role its own entries", () => {
    // D-087/D-088: the Admin's Setup is just "Programs"; Support keeps the whole Setup.
    // D-121: the Principal reaches attendance, classwork, results (Classes) and fees (a student's record) without menu entries.
    expect(seen("admin", "institution")).toEqual(["dashboard", "classes", "content", "programs", "terms", "people", "approvals", "admissions", "reports", "settings"]);
    expect(seen("super_admin", "institution")).toEqual(["dashboard", "classes", "content", "terms", "setup", "people", "approvals", "attendance", "classwork", "reports", "settings"]);
    // Reports too: the Co-ordinator holds the student and results reports (Co-ordinator FUT F-10).
    expect(seen("coordinator", "institution")).toEqual(["dashboard", "content", "setup", "people", "admissions", "attendance", "classwork", "reports", "settings"]);
    expect(seen("coordinator", "section")).toEqual(["dashboard", "content", "setup", "people", "admissions", "attendance", "classwork", "reports", "settings"]);
    expect(seen("accountant", "institution")).toEqual(["dashboard", "admissions", "settings"]);
    expect(seen("teacher", "assigned")).toEqual(["dashboard", "classes", "attendance", "classwork", "settings"]);
    expect(seen("student", "own")).toEqual(["dashboard", "classwork", "settings"]);
    // D-091: Settings is everyone's; Reports only the Principal's and Support's.
  });

  it("fees are in the menu for the Accountant and the student; never the Co-ordinator or a teacher; the Principal reads them on a student's record (D-121)", () => {
    const withFees = { attendance: true, fees: true };
    expect(seen("accountant", "institution", withFees)).toEqual(["dashboard", "admissions", "fees", "settings"]);
    expect(seen("student", "own", withFees)).toEqual(["dashboard", "classwork", "fees", "settings"]);
    expect(seen("admin", "institution", withFees)).not.toContain("fees");
    expect(seen("coordinator", "institution", withFees)).not.toContain("fees");
    expect(seen("teacher", "assigned", withFees)).not.toContain("fees");
  });

  it("results are for the teacher, the student, the Co-ordinator and the Admin, never the Accountant", () => {
    const withResults = { attendance: true, fees: true, results: true };
    expect(seen("teacher", "assigned", withResults)).toEqual(["dashboard", "classes", "attendance", "classwork", "results", "settings"]);
    expect(seen("student", "own", withResults)).toEqual(["dashboard", "classwork", "fees", "results", "settings"]);
    expect(seen("coordinator", "institution", withResults)).toContain("results");
    for (const id of ["results", "attendance", "classwork"]) expect(seen("admin", "institution", withResults)).not.toContain(id); // through Classes (D-121)
    expect(seen("accountant", "institution", withResults)).not.toContain("results");
  });

  it("a school that switched attendance off does not see it in the menu", () => {
    expect(seen("teacher", "assigned", { attendance: false })).toEqual(["dashboard", "classes", "classwork", "settings"]);
  });

  it("on a phone the daily places stay tabs and the rarely visited ones move into More", () => {
    const split = (role: string, scope: "institution" | "section") => {
      const { tabs, more } = splitNav(visibleNav(NAV_ITEMS, [{ role, scope }], { attendance: true }));
      return { tabs: tabs.map((i) => i.id), more: more.map((i) => i.id) };
    };
    expect(split("coordinator", "institution")).toEqual({ tabs: ["dashboard", "admissions", "attendance", "classwork"], more: ["content", "setup", "people", "reports", "settings"] });
    expect(split("admin", "institution")).toEqual({ tabs: ["dashboard", "classes", "approvals", "admissions"], more: ["content", "programs", "terms", "people", "reports", "settings"] });
  });
});

describe("splitNav", () => {
  const entry = (id: string, rarely = false): NavItem => ({ id, labelKey: "nav.dashboard", href: `/portal/${id}`, icon: "overview", ...(rarely ? { rarely } : {}) });

  it("keeps every entry a tab while they fit", () => {
    const menu = ["a", "b", "c", "d", "e"].map((id) => entry(id));
    expect(splitNav(menu)).toEqual({ tabs: menu, more: [] });
  });

  it("past the limit, the last tab is More: daily entries first, in menu order", () => {
    const menu = [entry("a"), entry("b", true), entry("c"), entry("d"), entry("e"), entry("f")];
    const { tabs, more } = splitNav(menu);
    expect(tabs.map((i) => i.id)).toEqual(["a", "c", "d", "e"]);
    expect(more.map((i) => i.id)).toEqual(["b", "f"]);
  });

  it("with too few daily entries, rarely ones fill the rest of the tabs in menu order", () => {
    const menu = [entry("a"), entry("b", true), entry("c", true), entry("d", true), entry("e", true), entry("f", true)];
    const { tabs, more } = splitNav(menu);
    expect(tabs.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(more.map((i) => i.id)).toEqual(["e", "f"]);
  });
});

describe("visibleNav", () => {
  const modules = { fees: true, homework: true };

  it("shows an item with no restriction to every signed-in person", () => {
    expect(ids(visibleNav(items, [{ role: "student", scope: "own" }], modules))).toContain("dashboard");
  });

  it("shows role-limited items only to those roles", () => {
    expect(ids(visibleNav(items, [{ role: "student", scope: "own" }], modules))).toEqual(["dashboard", "homework"]);
    expect(ids(visibleNav(items, [{ role: "accountant", scope: "institution" }], modules))).toEqual(["dashboard", "fees"]);
  });

  it("a person with two roles sees both roles' items", () => {
    const both = [
      { role: "teacher", scope: "assigned" as const },
      { role: "accountant", scope: "institution" as const },
    ];
    expect(ids(visibleNav(items, both, modules))).toEqual(["dashboard", "fees", "homework"]);
  });

  it("hides an item whose module this school has switched off", () => {
    expect(ids(visibleNav(items, [{ role: "teacher", scope: "assigned" }], { ...modules, homework: false }))).toEqual(["dashboard"]);
  });

  it("treats an unknown module as off, never as on", () => {
    expect(ids(visibleNav(items, [{ role: "teacher", scope: "assigned" }], {}))).toEqual(["dashboard"]);
  });

  it("Super Admin sees the unrestricted items but is not silently given every role's", () => {
    const superAdmin = [{ role: "super_admin", scope: "institution" as const }];
    expect(ids(visibleNav(items, superAdmin, modules))).toEqual(["dashboard"]);
  });

  it("a menu of one entry is not shown: there is nothing to choose between", () => {
    expect(showsMenu([])).toBe(false);
    expect(showsMenu(items.slice(0, 1))).toBe(false);
    expect(showsMenu(items.slice(0, 2))).toBe(true);
  });

  it("no role's phone tab bar ever holds more than it can: past the limit, the extra entries go into More", () => {
    const everyModuleOn = Object.fromEntries(NAV_ITEMS.flatMap((i) => (i.module ? [[i.module, true]] : [])));
    for (const role of ROLES) {
      const { tabs, more } = splitNav(visibleNav(NAV_ITEMS, [{ role }], everyModuleOn));
      expect(tabs.length + (more.length > 0 ? 1 : 0), role).toBeLessThanOrEqual(MAX_TABS);
    }
  });

  it("the real list starts with the dashboard, has unique ids and hrefs, and every href is under /portal", () => {
    expect(NAV_ITEMS[0]!.id).toBe("dashboard");
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(item.href.startsWith("/portal")).toBe(true);
  });
});

describe("Setup's menu entry (D-130)", () => {
  const setup = NAV_ITEMS.find((i) => i.id === "setup")!;
  it("opens Departments, the first tab, yet stays current on every Setup page", () => {
    expect(setup.opensAt).toBe("/portal/setup/programmes");
    for (const path of ["/portal/setup", "/portal/setup/programmes", "/portal/setup/classes", "/portal/setup/terminals"]) expect(isCurrent(path, setup.href)).toBe(true);
  });
});
