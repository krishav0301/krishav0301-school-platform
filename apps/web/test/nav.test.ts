import { describe, expect, it } from "vitest";

import { MAX_TABS, NAV_ITEMS, showsMenu, visibleNav, type NavItem } from "@/shell/nav";
import { ROLES } from "../../api/src/core/roles";

const items: NavItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", href: "/portal" },
  { id: "fees", labelKey: "nav.dashboard", href: "/portal/fees", roles: ["accountant", "admin"], module: "fees" },
  { id: "homework", labelKey: "nav.dashboard", href: "/portal/homework", roles: ["teacher", "student"], module: "homework" },
];
const ids = (list: NavItem[]) => list.map((i) => i.id);

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

  it("no role is ever offered more than the tab bar can hold: add a More tab before adding a sixth entry", () => {
    const everyModuleOn = Object.fromEntries(NAV_ITEMS.flatMap((i) => (i.module ? [[i.module, true]] : [])));
    for (const role of ROLES) {
      expect(visibleNav(NAV_ITEMS, [{ role }], everyModuleOn).length, role).toBeLessThanOrEqual(MAX_TABS);
    }
  });

  it("the real list starts with the dashboard, has unique ids and hrefs, and every href is under /portal", () => {
    expect(NAV_ITEMS[0]!.id).toBe("dashboard");
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(item.href.startsWith("/portal")).toBe(true);
  });
});
