import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PortalPage from "@/app/portal/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ROLE_BRIEFS, RoleBriefLinks } from "@/dashboard/RoleBrief";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import sample from "../../../packs/sample-basic-school/pack.json";
import { sectionsOf } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

type PackJson = typeof royal | typeof sample;
const configFor = (pack: PackJson, modules: Record<string, boolean> = {}): PublicConfig => ({
  school: { name: pack.school.name, shortName: pack.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: sectionsOf(pack),
  modules,
  // The API sends every word resolved: the defaults, then the school's own (as render.test.tsx does).
  terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", ...(pack.terminology as Record<string, string>) },
  theme: pack.theme as PublicConfig["theme"],
});
const render = (node: React.ReactNode, pack: PackJson = royal, roles: { role: string; scope: "institution" | "own" | "assigned" }[] = [{ role: "coordinator", scope: "institution" }], modules: Record<string, boolean> = {}) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", configFor(pack, modules))}>
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { id: "user-1", name: "Sita", roles } })}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("what each role can do (the PM, 2026-10-01)", () => {
  it("every line leads to a page that exists", () => {
    const app = join(__dirname, "..", "src", "app");
    for (const [role, brief] of Object.entries(ROLE_BRIEFS)) {
      for (const line of brief.lines) expect(existsSync(join(app, ...line.href.split("/").filter(Boolean), "page.tsx")), `${role} ${line.href}`).toBe(true);
    }
  });

  it("names the role in the school's own words", () => {
    expect(render(<RoleBriefLinks role="accountant" />)).toContain("What you can do as Accountant");
    expect(render(<RoleBriefLinks role="student" />, sample)).toContain("What you can do as Pupil");
  });

  it("leaves out what the school has switched off", () => {
    const on = render(<RoleBriefLinks role="student" />, royal, [{ role: "student", scope: "own" }], { attendance: true, fees: true });
    const off = render(<RoleBriefLinks role="student" />, royal, [{ role: "student", scope: "own" }], { attendance: false, fees: false });
    expect(on).toContain("See your attendance");
    expect(on).toContain("See your fees and receipts");
    expect(off).not.toContain("See your attendance");
    expect(off).not.toContain("See your fees and receipts");
    expect(off).toContain("See your results and marks card");
  });

  it("the Accountant has no home page of their own (they land on Students); with a student role the student's brief shows", () => {
    expect(render(<PortalPage />, royal, [{ role: "accountant", scope: "institution" }])).not.toContain("What you can do as Accountant");
    const both = render(<PortalPage />, royal, [
      { role: "accountant", scope: "institution" },
      { role: "student", scope: "own" },
    ]);
    expect(both).toContain("What you can do as Student");
  });
});
