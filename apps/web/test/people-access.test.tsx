import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { AddPersonDialog, ManageAccessDialog } from "@/people/AccessDialogs";
import type { Person } from "@/people/access-client";
import { chosenSections, emptyAdd, initials, lastSignIn, scopeWords, seesAccessCentre, signInLine, validateStep } from "@/people/access-model";
import { addOpen, PeopleAccess } from "@/people/PeopleAccess";
import { SessionContext } from "@/session/SessionProvider";

import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";
import { fakeSession } from "./session";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/people", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** People & Access (D-099): the Principal's access-control centre. */

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "role.admin": "Principal", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.teacher": "Teacher" },
  theme: royal.theme as PublicConfig["theme"],
};
const admin = fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role: "admin", scope: "institution" }] } });
const render = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={admin}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const sections = [
  { key: "plus2", name: "+2 (Grade 11–12)", active: true },
  { key: "bachelors", name: "Bachelor's", active: true },
  { key: "old", name: "Old section", active: false },
];
const person = (over: Partial<Person> = {}): Person => ({
  id: "0123456789abcdef0123456789abcdef",
  fullName: "Hari Prasad Yadav",
  email: "hari@school.example",
  phone: null,
  role: "coordinator",
  sections: [{ key: "bachelors", name: "Bachelor's" }],
  homeSection: null,
  active: true,
  mustChangePassword: true,
  lastSignInAt: null,
  subjects: [],
  programmes: [],
  addedBy: null,
  canManage: true,
  ...over,
});

describe("who gets the access-control centre", () => {
  it("the Principal and Support; a Co-ordinator keeps their own People screens", () => {
    expect(seesAccessCentre([{ role: "admin", scope: "institution" }])).toBe(true);
    expect(seesAccessCentre([{ role: "super_admin", scope: "institution" }])).toBe(true);
    expect(seesAccessCentre([{ role: "coordinator", scope: "institution" }])).toBe(false);
    expect(seesAccessCentre([{ role: "accountant", scope: "institution" }])).toBe(false);
  });
});

describe("plain words (D-099)", () => {
  const now = new Date("2026-10-02T06:00:00Z");

  it("account status and sign-in are separate: the sign-in line alone says when", () => {
    expect(signInLine(null, now)).toBe("Never signed in yet");
    expect(signInLine("2026-09-30T06:00:00Z", now)).toBe("Last signed in 2 days ago");
    expect(lastSignIn(null, now)).toBe("Never");
    expect(lastSignIn("2026-10-02T05:00:00Z", now)).toBe("1 hour ago");
  });

  it("access reaches the whole school, or names the sections", () => {
    expect(scopeWords(person({ sections: [] }))).toBe("Whole school");
    expect(scopeWords(person({ sections: [{ key: "a", name: "+2" }, { key: "b", name: "Bachelor's" }] }))).toBe("+2, Bachelor's");
  });

  it("initials for the circle", () => {
    expect(initials("Hari Prasad Yadav")).toBe("HY");
    expect(initials("Gita")).toBe("G");
    expect(initials("  ")).toBe("");
  });

  it("each step of Add a person checks only its own part", () => {
    expect(validateStep("role", emptyAdd())).toEqual({ role: "access.error.roleRequired" });
    expect(validateStep("details", { ...emptyAdd(), role: "accountant", fullName: "G", email: "x" })).toEqual({ fullName: "people.error.nameRequired", email: "people.error.emailInvalid" });
    expect(validateStep("access", { ...emptyAdd(), wholeSchool: false, sectionKeys: [] })).toEqual({ sections: "access.error.sectionsRequired" });
    expect(validateStep("access", { ...emptyAdd(), wholeSchool: true })).toEqual({});
  });

  it("the whole school sends no sections; chosen sections are sent sorted", () => {
    expect(chosenSections({ wholeSchool: true, sectionKeys: ["b"] })).toEqual([]);
    expect(chosenSections({ wholeSchool: false, sectionKeys: ["plus2", "bachelors"] })).toEqual(["bachelors", "plus2"]);
  });
});

describe("the page", () => {
  const html = render(<PeopleAccess />);

  it("is People & Access, with the three counts, How access works and two tabs, Staff & Access chosen", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<h1[^>]*>People &amp; Access<\/h1>/);
    for (const label of ["Teaching staff", "Co-ordinators", "Accountants", "How access works"]) expect(html, label).toContain(label);
    expect(html).toContain("The Principal gives access to the Co-ordinator and the Accountant. A Co-ordinator manages teachers and classes.");
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Staff &amp; Access</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Teaching</);
  });

  it("shows the shape of the list while it loads, never hard-coded numbers or names", () => {
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading people");
    expect(html).not.toMatch(/>\d+<\/span><span class="muted">Teaching staff/);
    expect(html).not.toMatch(/Gita|Hari|Ramesh/);
  });

  it("has one prominent action, Add a person, and no way to create a teacher", () => {
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*primary[^>]*>.*Add a person<\/button>/);
    expect(html).not.toMatch(/Add (a )?teacher/i);
  });
});

describe("Add a person", () => {
  const html = render(<AddPersonDialog sections={sections} onClose={() => {}} onCreated={() => {}} />);

  it("offers a Co-ordinator or an Accountant, and never a teacher", () => {
    expect(count(html, /<input type="radio"[^>]*name="role"/g)).toBe(2);
    expect(html).toContain("Manage academic areas, classes and teachers.");
    expect(html).toContain("Manage fees and financial information.");
    expect(html).not.toMatch(/value="teacher"|>Teacher</);
    expect(html).toContain("Teachers are added by a Co-ordinator, not here.");
  });

  it("is a titled dialog with numbered steps, Cancel and Next", () => {
    expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);
    expect(html).toContain(">Add a person</h2>");
    expect(html).toContain("Give someone administrative access to the school platform.");
    for (const step of ["Role", "Details", "Access", "Review"]) expect(html).toContain(`>${step}</li>`);
    expect(html).toMatch(/aria-current="step"[^>]*>Role</);
    expect(html).toMatch(/>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*primary[^>]*>Next<\/button>/);
  });
});

describe("Add a person from the dashboard (PM, 2026-10-06)", () => {
  it("opens on Details with the role already chosen when asked for a Co-ordinator or an Accountant", () => {
    for (const role of ["coordinator", "accountant"] as const) {
      const preset = render(<AddPersonDialog sections={sections} startRole={role} onClose={() => {}} onCreated={() => {}} />);
      expect(preset).toMatch(/aria-current="step"[^>]*>Details</);
      expect(preset).toContain("Full name");
      expect(count(preset, /<input type="radio"[^>]*name="role"/g)).toBe(0);
    }
  });
});

describe("which Add pop-up is open", () => {
  it("the dashboard's ?add= opens it, and Close shuts it even though nothing was chosen on this page (the PM's bug, 2026-10-06)", () => {
    expect(addOpen(false, "coordinator", false)).toBe("coordinator");
    expect(addOpen(false, "coordinator", true)).toBe(false); // closed: stays closed while the address still says ?add=
    expect(addOpen("any", "coordinator", true)).toBe("any"); // the page's own Add button still opens it afterwards
    expect(addOpen(false, null, false)).toBe(false);
  });
});

describe("Manage access", () => {
  const html = render(<ManageAccessDialog person={person()} sections={sections} now={new Date("2026-10-02T06:00:00Z")} onClose={() => {}} onChanged={() => {}} onToggle={() => {}} onNewPassword={() => {}} />);

  it("shows the person, their role, account and sign-in as separate facts", () => {
    expect(html).toContain("Hari Prasad Yadav");
    expect(html).toContain(">Co-ordinator</dd>");
    expect(html).toContain("Active");
    expect(html).toContain("Never signed in yet");
    expect(html).toContain("Has not chosen their own password yet.");
  });

  it("lets their access be changed to the whole school or chosen sections, never a switched-off one", () => {
    expect(html).toContain("Selected Wings");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/?>Bachelor&#x27;s/);
    expect(html).toContain("+2 (Grade 11–12)");
    expect(html).not.toContain("Old section");
    expect(html).toContain("within 30 minutes");
  });

  it("says in plain words what the role can do, never permission ids", () => {
    expect(html).toContain("What a Co-ordinator can do");
    expect(html).toContain("Add teachers and give them their subjects and classes");
    expect(html).not.toMatch(/accounts\.|setup\.|\.manage|\.view/);
  });

  it("Save access waits for a change; Switch off and a new temporary password are there for an active person", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save access<\/button>/);
    expect(html).toContain(">Switch off</button>");
    expect(html).toContain(">New temporary password</button>");
    const off = render(<ManageAccessDialog person={person({ active: false })} sections={sections} now={new Date()} onClose={() => {}} onChanged={() => {}} onToggle={() => {}} onNewPassword={() => {}} />);
    expect(off).toContain(">Switch on</button>");
    expect(off).not.toContain(">New temporary password</button>");
  });
});
