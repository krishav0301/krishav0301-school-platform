import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { addableRoles } from "@/people/model";
import { ReportsScreen } from "@/reports/ReportsScreen";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/reports", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// Fees can be switched off for a school that only runs results (D-137, the PM 2026-10-11).
const config = (fees: boolean): PublicConfig => ({
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { fees, results: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
});
const principal = fakeSession({ status: "signedIn", me: { name: "Principal", roles: [{ role: "admin", scope: "institution" }] } });
const reports = (fees: boolean) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(fees))}>
      <SessionContext.Provider value={principal}>
        <ReportsScreen />
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("with Fees switched off", () => {
  it("the Reports hub leaves out the money group and its three pages", () => {
    const off = reports(false);
    expect(off).not.toContain("/portal/fees");
    expect(off).toContain("/portal/results/sheets"); // results are still there
    const on = reports(true);
    expect(on).toContain("/portal/fees/dues");
    expect(on).toContain("/portal/fees/structures");
  });

  it("nobody can add an Accountant: not the Admin, not Support", () => {
    const admin = [{ role: "admin", scope: "institution" as const }];
    const support = [{ role: "super_admin", scope: "institution" as const }];
    expect(addableRoles(admin)).toEqual(["coordinator", "accountant"]);
    expect(addableRoles(admin, false)).toEqual(["coordinator"]);
    expect(addableRoles(support, false)).toEqual(["coordinator", "teacher"]);
    expect(addableRoles([{ role: "coordinator", scope: "institution" as const }], false)).toEqual(["teacher"]);
  });
});
