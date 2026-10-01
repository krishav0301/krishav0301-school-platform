import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { REPORT_GROUPS, ReportsScreen } from "@/reports/ReportsScreen";
import { SessionContext } from "@/session/SessionProvider";
import { ownPasswordFailure, profileProblems } from "@/settings/model";
import { PasswordCard, ProfileCard } from "@/settings/SettingsScreen";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/settings", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const session = fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role: "coordinator", scope: "institution" }] } });
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{node}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

describe("Settings (D-091)", () => {
  it("says plainly why a password change was refused", () => {
    expect(ownPasswordFailure(422, { error: "wrong_password" })).toEqual(["settings.password.wrong"]);
    expect(ownPasswordFailure(429, { error: "throttled" })).toEqual(["settings.password.throttled"]);
    expect(ownPasswordFailure(422, { error: "same_password" })).toEqual(["signIn.samePassword"]);
    expect(ownPasswordFailure(422, { error: "weak_password", problems: ["too_short", "contains_school_name"] })).toEqual(["reset.weak.too_short", "reset.weak.contains_school_name"]);
    expect(ownPasswordFailure(500, null)).toEqual(["settings.failed"]);
  });

  it("checks a profile before sending it", () => {
    expect(profileProblems({ fullName: "Sita Sharma", phone: "" })).toEqual([]);
    expect(profileProblems({ fullName: " ", phone: "" })).toEqual(["settings.profile.nameInvalid"]);
    expect(profileProblems({ fullName: "Sita", phone: "98" })).toEqual(["settings.profile.phoneInvalid"]);
  });

  it("staff get a form for their own name and phone; the email is shown, not editable", () => {
    const html = render(<ProfileCard profile={{ fullName: "Sita Sharma", email: "sita@school.example", phone: "9800000001", canEditProfile: true }} />);
    expect(html).toContain("<form");
    expect(html).toContain('value="Sita Sharma"');
    expect(html).toContain("You sign in with sita@school.example");
    expect(html).not.toContain('value="sita@school.example"');
  });

  it("a student sees their details and is told the Co-ordinator corrects them", () => {
    const html = render(<ProfileCard profile={{ fullName: "Asha Rai", email: "asha@school.example", phone: null, canEditProfile: false }} />);
    expect(html).not.toContain("<form");
    expect(html).toContain("Asha Rai");
    expect(html).toContain("ask your Co-ordinator");
  });

  it("the password form asks for the current password and a new one, with the browser's own password hints", () => {
    const html = render(<PasswordCard />);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/autocomplete="new-password"/i);
  });
});

describe("Reports (D-091)", () => {
  it("every place listed is a page that exists, under the portal", () => {
    const app = join(__dirname, "..", "src", "app");
    for (const group of REPORT_GROUPS) {
      for (const entry of group.entries) {
        expect(entry.href, entry.href).toMatch(/^\/portal\//);
        expect(existsSync(join(app, ...entry.href.split("/").filter(Boolean), "page.tsx")), entry.href).toBe(true);
      }
    }
  });

  it("shows the groups with a heading each and the school's own word for a term", () => {
    const html = render(<ReportsScreen />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("School setup");
    expect(html).toContain("Find a student");
    expect(html).toContain("Class result sheets");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
