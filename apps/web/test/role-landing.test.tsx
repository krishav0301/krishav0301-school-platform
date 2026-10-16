import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PortalPage from "@/app/portal/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { RoleLanding, landingPlaces } from "@/dashboard/RoleLanding";
import { SessionContext } from "@/session/SessionProvider";
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
const render = (node: React.ReactNode, roles: { role: string; scope: "institution" | "own" | "assigned" }[], modules: Record<string, boolean> = { attendance: true, results: true, fees: true, homework: true, notes: true, activity_log: true }) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(modules))}>
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { id: "user-1", name: "Sita", roles } })}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("the landing page of the Co-ordinator, Teacher and Student (the PM, 2026-10-17)", () => {
  it("is a hero with the greeting, the role and the school, then a tile for each place the person can go", () => {
    const html = render(<RoleLanding role="teacher" />, [{ role: "teacher", scope: "assigned" }]);
    expect(html).toMatch(/<h1[^>]*>Good (morning|afternoon|evening), Sita</);
    expect(html).toContain("Teacher · Royal Softech");
    for (const place of ["Classes", "Attendance", "Classwork", "Results", "Settings"]) expect(html).toContain(`>${place}<`);
    expect(html).toContain('href="/portal/results"');
    expect(html).not.toContain(">Overview<"); // this page is the overview
  });

  it("has no figures, lists or charts", () => {
    const html = render(<RoleLanding role="coordinator" />, [{ role: "coordinator", scope: "institution" }]);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("Today");
  });

  it("lists only the places the roles reach in this school: a switched-off module is not there", () => {
    const roles = [{ role: "student", scope: "own" as const }];
    expect(landingPlaces(roles, { homework: true, fees: true, results: true }).map((p) => p.id)).toEqual(["classwork", "fees", "results", "settings"]);
    expect(landingPlaces(roles, { fees: true, results: true }).map((p) => p.id)).toEqual(["fees", "results", "settings"]);
    expect(landingPlaces(roles, { results: true }).map((p) => p.id)).toEqual(["results", "settings"]);
  });

  it("the Co-ordinator reaches Setup where the menu opens it, and someone with two roles sees every place of both", () => {
    const both = landingPlaces([{ role: "coordinator", scope: "institution" }, { role: "teacher", scope: "assigned" }], { attendance: true, results: true });
    expect(both.map((p) => p.id)).toEqual(expect.arrayContaining(["classes", "setup", "people", "admissions", "attendance", "results"]));
    const html = render(<RoleLanding role="coordinator" />, [{ role: "coordinator", scope: "institution" }]);
    expect(html).toContain('href="/portal/setup/map"');
  });

  it("is the portal's home for these three roles; the Principal keeps the dashboard and the Accountant their fees day", () => {
    expect(render(<PortalPage />, [{ role: "coordinator", scope: "institution" }])).toContain("Co-ordinator · Royal Softech");
    expect(render(<PortalPage />, [{ role: "student", scope: "own" }])).toContain("Student · Royal Softech");
    expect(render(<PortalPage />, [{ role: "accountant", scope: "institution" }])).toContain("What you can do as Accountant");
    expect(render(<PortalPage />, [{ role: "admin", scope: "institution" }])).not.toContain("Where to go");
  });
});
