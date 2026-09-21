import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PeoplePage from "@/app/portal/people/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import type { StaffMember } from "@/people/model";
import { StaffForm, StaffScreen, StaffView, TemporaryPasswordNotice } from "@/people/StaffScreen";
import { NewPasswordStep } from "@/session/NewPasswordStep";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/people", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: {},
  terms: { "role.coordinator": "Vice Principal", "role.accountant": "Accountant", "role.teacher": "Teacher" },
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section", section?: string) =>
  fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope, ...(section ? { section } : {}) }] } });
const inContext = (element: React.ReactNode, session = as("admin", "institution")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const noop = () => {};

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: "m1",
  fullName: "Sita Sharma",
  email: "sita@school.example",
  phone: null,
  roles: [{ role: "coordinator", scope: "institution", section: null }],
  homeSection: null,
  active: true,
  mustChangePassword: false,
  lastSignInAt: "2026-09-21T10:00:00Z",
  ...over,
});
const sections = royal.sections;
const adminRoles = [{ role: "admin", scope: "institution" }];
const cooRoles = [{ role: "coordinator", scope: "institution" }];

// ---------------------------------------------------------------------------------------------
describe("the staff list", () => {
  const staff = [
    member(),
    member({ id: "m2", fullName: "Ram Karki", email: "ram@school.example", roles: [{ role: "teacher", scope: "assigned", section: null }], homeSection: "plus2", mustChangePassword: true, lastSignInAt: null }),
    member({ id: "m3", fullName: "Hari Rai", email: "hari@school.example", roles: [{ role: "accountant", scope: "section", section: "bachelors" }], active: false }),
  ];
  const view = (roles = adminRoles) => inContext(<StaffView staff={staff} roles={roles} sections={sections} busy={null} onToggle={noop} onIssue={noop} />);

  it("shows each person with their role in the school's own word, their section, and where they stand", () => {
    const html = view();
    for (const name of ["Sita Sharma", "Ram Karki", "Hari Rai"]) expect(html).toContain(`>${name}</h2>`);
    expect(html).toContain("sita@school.example");
    expect(html).toContain(">Vice Principal<");
    expect(html).toContain(">Teacher<");
    expect(html).toContain(">Accountant<");
    expect(html).toContain(">Whole school<"); // the Vice Principal
    expect(html).toContain(">+2<"); // the teacher's home section
    expect(html).toContain(">Bachelor&#x27;s<"); // the accountant's section
    expect(html).toContain(">Has not signed in yet<");
    expect(html).toContain(">Switched off<");
  });

  it("gives switch and new-password controls only for people the viewer may manage, and none for a switched-off person's password", () => {
    const admin = view(adminRoles);
    expect(admin).toContain('aria-label="Switch off Sita Sharma"');
    expect(admin).toContain('aria-label="New temporary password for Sita Sharma"');
    expect(admin).toContain('aria-label="Switch on Hari Rai"');
    expect(admin).not.toContain("New temporary password for Hari Rai"); // switched off: nothing to give
    expect(admin).not.toContain("Switch off Ram Karki"); // the Admin does not manage teachers
    expect(admin).not.toContain("New temporary password for Ram Karki");

    const coordinator = view(cooRoles);
    expect(coordinator).toContain('aria-label="Switch off Ram Karki"');
    expect(coordinator).toContain('aria-label="New temporary password for Ram Karki"');
    expect(coordinator).not.toContain("Switch off Sita Sharma");
  });

  it("says so when there is no one yet", () => {
    expect(inContext(<StaffView staff={[]} roles={adminRoles} sections={sections} busy={null} onToggle={noop} onIssue={noop} />)).toContain("No one yet. Add the first person.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the add form", () => {
  it("for an Admin: a role to choose (in the school's words), the name, email, optional phone, and an optional section that starts as the whole school", () => {
    const html = inContext(<StaffForm roles={adminRoles} sections={sections} onCreated={noop} />);
    expect(html).toContain(">Add a person<");
    expect(html).toContain(">Role<");
    expect(html).toContain(">Vice Principal<");
    expect(html).toContain(">Accountant<");
    expect(html).not.toContain(">Teacher<"); // an Admin does not add teachers
    for (const label of ["Full name", "Email", "Phone (optional)", "Section (optional)"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(">Whole school<");
    expect(html).toContain('type="email"');
    expect(html).toContain('type="tel"');
  });

  it("for a Co-ordinator: no role to choose (only teachers), and a required home section", () => {
    const html = inContext(<StaffForm roles={cooRoles} sections={sections} onCreated={noop} />);
    expect(html).not.toContain(">Role<");
    expect(html).toContain("They will be a Teacher.");
    expect(html).toContain(">Home section<");
    expect(html).not.toContain("Whole school");
    expect(html).toContain(">+2<");
    expect(html).toContain(">Bachelor&#x27;s<");
  });

  it("a section-scoped Co-ordinator can only choose their own section", () => {
    const html = inContext(<StaffForm roles={[{ role: "coordinator", scope: "section", section: "plus2" }]} sections={sections} onCreated={noop} />);
    expect(html).toContain(">+2<");
    expect(html).not.toContain("Bachelor&#x27;s");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the one-time password notice", () => {
  const html = inContext(<TemporaryPasswordNotice name="Ram Karki" password="K7M2-QX9R-4TBW-HC3P" onDone={noop} />);

  it("shows the password once, says it is shown once, offers to copy it, and asks for a plain acknowledgement", () => {
    expect(html).toContain("Temporary password for Ram Karki");
    expect(count(html, /K7M2-QX9R-4TBW-HC3P/g)).toBe(1);
    expect(html).toContain("shown once");
    expect(html).toContain("choose their own password");
    expect(html).toMatch(/<button[^>]*>Copy<\/button>/);
    expect(html).toContain(">I have noted it<");
  });

  it("is a labelled region a screen reader announces, and the password is selectable as one piece", () => {
    expect(html).toMatch(/role="(status|alert|region)"/);
    expect(html).toMatch(/aria-label="Temporary password"|aria-labelledby/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the staff screen and its page", () => {
  it("shows the shape of the page while it loads, and the add form to someone who may add", () => {
    const html = inContext(<StaffScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Staff</h1>");
    expect(html).toContain(">Add a person<");
  });

  it("the page has the portal around it", () => {
    const html = inContext(<PeoplePage />);
    expect(html).toContain(">Staff</h1>");
    expect(html).toContain("Skip to main content");
  });
});

// ---------------------------------------------------------------------------------------------
describe("choosing your own password (the sign-in step)", () => {
  const html = inContext(<NewPasswordStep challenge="c" onNext={noop} onRestart={noop} />, fakeSession());

  it("explains why, in plain words, with the rules", () => {
    expect(html).toContain("Choose your own password");
    expect(html).toContain("temporary password");
    expect(html).toContain("at least 10 characters");
  });

  it("has one password box with a show and hide button (no repeat box), and one button to go on", () => {
    expect(count(html, /type="password"/g)).toBe(1);
    expect(html).toContain(">New password<");
    expect(html).toContain(">Show<");
    expect(html).toContain(">Save password and continue<");
    expect(html).toContain('autoComplete="new-password"');
  });
});
