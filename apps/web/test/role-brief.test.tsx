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
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { name: "Sita", roles } })}>{node}</SessionContext.Provider>
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
    expect(render(<RoleBriefLinks role="coordinator" />)).toContain("What you can do as Co-ordinator");
    expect(render(<RoleBriefLinks role="coordinator" />, sample)).toContain("What you can do as Vice Principal");
  });

  it("leaves out what the school has switched off", () => {
    const on = render(<RoleBriefLinks role="teacher" />, royal, [{ role: "teacher", scope: "assigned" }], { attendance: true, homework: true });
    const off = render(<RoleBriefLinks role="teacher" />, royal, [{ role: "teacher", scope: "assigned" }], { attendance: false, homework: false });
    expect(on).toContain("Mark your class&#x27;s attendance");
    expect(off).not.toContain("Mark your class&#x27;s attendance");
    expect(off).not.toContain("Set homework");
    expect(off).toContain("Write what each class did today");
  });

  it("each role's home shows its own brief, and a person with two roles sees both", () => {
    expect(render(<PortalPage />, royal, [{ role: "accountant", scope: "institution" }])).toContain("What you can do as Accountant");
    expect(render(<PortalPage />, royal, [{ role: "student", scope: "own" }])).toContain("What you can do as Student");
    const both = render(<PortalPage />, royal, [
      { role: "teacher", scope: "assigned" },
      { role: "accountant", scope: "institution" },
    ]);
    expect(both).toContain("What you can do as Teacher");
    expect(both).toContain("What you can do as Accountant");
    expect(both.match(/<h1/g)).toHaveLength(1);
  });
});
