import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ChecklistCard, ChecklistView } from "@/setup/ChecklistCard";
import type { Checklist } from "@/setup/checklist-client";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section" = "institution") =>
  fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role, scope, ...(scope === "section" ? { section: "plus2" } : {}) }] } });
const inContext = (element: React.ReactNode, session = as("coordinator")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const empty: Checklist = { year: false, structure: false, classes: false, terminals: false, subjects: false, teachers: false, classTeachers: false };
const full: Checklist = { year: true, structure: true, classes: true, terminals: true, subjects: true, teachers: true, classTeachers: true };

// ---------------------------------------------------------------------------------------------
describe("the checklist view", () => {
  it("shows all seven items, in their fixed order, each with its label and link", () => {
    const html = inContext(<ChecklistView checklist={empty} />);
    const order = ["portal.checklist.year", "portal.checklist.structure", "portal.checklist.classes", "portal.checklist.terminals", "portal.checklist.subjects", "portal.checklist.teachers", "portal.checklist.classTeachers"];
    const hrefs = ["/portal/setup", "/portal/setup/programmes", "/portal/setup/classes", "/portal/setup/terminals", "/portal/setup/curriculum", "/portal/people", "/portal/people/teaching"];
    for (const href of hrefs) expect(html).toContain(`href="${href}"`);
    const positions = order.map((key) => html.indexOf(`href="${hrefs[order.indexOf(key)]}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marks a done item done and a not-done item not done", () => {
    const html = inContext(<ChecklistView checklist={{ ...empty, year: true }} />);
    expect(html).toMatch(/Set an active academic year<\/a>[\s\S]{0,80}>Done</);
    expect(html).toMatch(/Add programmes and levels<\/a>[\s\S]{0,80}>Not done</);
  });

  it("every item done reads done throughout", () => {
    const html = inContext(<ChecklistView checklist={full} />);
    expect((html.match(/>Done</g) ?? []).length).toBe(7);
    expect(html).not.toContain("Not done");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the checklist card", () => {
  it("shows the shape of the card while it loads, for a Co-ordinator", () => {
    const html = inContext(<ChecklistCard />);
    expect(html).toContain("Setup checklist");
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });

  it("does not render at all for an Admin", () => {
    expect(inContext(<ChecklistCard />, as("admin"))).toBe("");
  });

  it("does not render at all for a Super Admin", () => {
    expect(inContext(<ChecklistCard />, as("super_admin"))).toBe("");
  });

  it("renders for a section-scoped Co-ordinator too", () => {
    expect(inContext(<ChecklistCard />, as("coordinator", "section"))).toContain("Setup checklist");
  });
});
