import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PortalPage from "@/app/portal/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { RoleLanding } from "@/dashboard/RoleLanding";
import { SessionContext } from "@/session/SessionProvider";
import { NAV_ITEMS, visibleNav } from "@/shell/nav";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config = (modules: Record<string, boolean>): PublicConfig => ({
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules,
  terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Principal" },
  theme: royal.theme as PublicConfig["theme"],
});
const render = (node: React.ReactNode, roles: { role: string; scope: "institution" | "own" | "assigned" }[], modules: Record<string, boolean> = { attendance: true, results: true, fees: true }) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(modules))}>
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { id: "user-1", name: "Sita", roles } })}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("the landing page of the Co-ordinator, Teacher and Student (the PM, 2026-10-17)", () => {
  it("is one hero: the school, the greeting, the role, a picture and a line to start from the menu", () => {
    const html = render(<RoleLanding role="teacher" />, [{ role: "teacher", scope: "assigned" }]);
    expect(html).toMatch(/<h1[^>]*>Good (morning|afternoon|evening), Sita</);
    expect(html).toContain("Royal Softech College");
    expect(html).toContain("Teacher");
    expect(html).toContain("Choose a place in the menu to begin.");
    expect(html).toMatch(/data-size="hero"/); // the picture (or its placeholder)
  });

  it("has no tiles, figures, lists or charts: the work starts from the menu", () => {
    const html = render(<RoleLanding role="coordinator" />, [{ role: "coordinator", scope: "institution" }]);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain('role="img"');
  });

  it("each role has its own picture", () => {
    const code = (role: "coordinator" | "teacher" | "student") => {
      const html = render(<RoleLanding role={role} />, [{ role, scope: "own" }]);
      return /\/illustrations\/(\w+)\.webp/.exec(html)?.[1] ?? /data-code="(\w+)"/.exec(html)?.[1];
    };
    const codes = (["coordinator", "teacher", "student"] as const).map(code);
    expect(codes.every(Boolean)).toBe(true);
    expect(new Set(codes).size).toBe(3);
  });

  it("is the portal's home for these three roles; the Principal keeps the dashboard; the Accountant lands on Students", () => {
    expect(render(<PortalPage />, [{ role: "coordinator", scope: "institution" }])).toContain("Choose a place in the menu to begin.");
    expect(render(<PortalPage />, [{ role: "student", scope: "own" }])).toContain("Choose a place in the menu to begin.");
    expect(render(<PortalPage />, [{ role: "accountant", scope: "institution" }])).not.toContain("Choose a place in the menu");
    expect(render(<PortalPage />, [{ role: "admin", scope: "institution" }])).not.toContain("Choose a place in the menu");
  });

  it("their menu has no Overview; the Principal and Support keep theirs", () => {
    const has = (role: string) => visibleNav(NAV_ITEMS, [{ role }], { results: true, attendance: true, fees: true }).some((i) => i.id === "dashboard");
    expect(["coordinator", "teacher", "student", "accountant"].map(has)).toEqual([false, false, false, false]);
    expect(["admin", "super_admin"].map(has)).toEqual([true, true]);
    // Someone with two roles keeps it if either needs it.
    expect(visibleNav(NAV_ITEMS, [{ role: "teacher" }, { role: "admin" }], {}).some((i) => i.id === "dashboard")).toBe(true);
  });
});
