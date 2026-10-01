import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SetupPage from "@/app/portal/setup/page";
import ProgrammesPage from "@/app/portal/setup/programmes/page";
import ClassesPage from "@/app/portal/setup/classes/page";
import TerminalsPage from "@/app/portal/setup/terminals/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SetupTabs } from "@/setup/SetupLayout";
import { ClassForm, ClassesView } from "@/setup/ClassesScreen";
import { ProgrammesView, SectionsCard } from "@/setup/ProgrammesScreen";
import { TerminalsView } from "@/setup/TerminalsScreen";
import { YearsScreen, YearsView } from "@/setup/YearsScreen";
import type { Programme, SchoolClass, Terminal, Year } from "@/setup/model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/setup", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "term.programme": "Programme", "term.level": "Level", "term.section": "Section", "term.terminal": "Exam", "role.coordinator": "Vice Principal" },
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section", section?: string) =>
  fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role, scope, ...(section ? { section } : {}) }] } });
const inContext = (element: React.ReactNode, session = as("coordinator", "institution")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const year = (id: string, label: string, status: Year["status"]): Year => ({ id, bsYear: 2083, label, startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", status });
const noop = () => {};

// ---------------------------------------------------------------------------------------------
describe("the sub-menu", () => {
  it("links to the four screens, marks exactly the current one, and uses the school's own words", () => {
    const html = inContext(<SetupTabs pathname="/portal/setup/terminals" />);
    for (const href of ["/portal/setup", "/portal/setup/programmes", "/portal/setup/classes", "/portal/setup/terminals"]) expect(html).toContain(`href="${href}"`);
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Exams</);
    expect(html).toContain(">Programmes<");
    expect(html).toContain('aria-label="Setup sections"');
  });

  it("a trailing slash in the address still marks the right one", () => {
    expect(inContext(<SetupTabs pathname="/portal/setup/classes/" />)).toMatch(/aria-current="page"[^>]*>Classes</);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the years screen", () => {
  const years = [year("y3", "2084", "draft"), year("y2", "2083", "active"), year("y1", "2082", "closed")];

  it("lists each year with its Nepali days and where it stands", () => {
    const html = inContext(<YearsView years={years} canManage busy={null} onActivate={noop} />);
    for (const label of ["2084", "2083", "2082"]) expect(html).toContain(`>${label}</h2>`);
    expect(html).toContain("1 Baisakh 2083");
    expect(html).toContain(">Current year<");
    expect(html).toContain(">Closed<");
    expect(html).toContain(">Not started<");
  });

  it("offers 'Make current' only for a draft, and only when no year is current", () => {
    const withCurrent = inContext(<YearsView years={years} canManage busy={null} onActivate={noop} />);
    expect(withCurrent).not.toContain("Make current");
    const none = inContext(<YearsView years={[year("y3", "2084", "draft")]} canManage busy={null} onActivate={noop} />);
    expect(none).toContain('aria-label="Make 2084 the current year"');
    expect(inContext(<YearsView years={[year("y3", "2084", "draft")]} canManage={false} busy={null} onActivate={noop} />)).not.toContain("Make current");
  });

  it("says so when there is no year yet", () => {
    expect(inContext(<YearsView years={[]} canManage busy={null} onActivate={noop} />)).toContain("Add the first one");
  });

  it("does not invite someone who cannot add a year to add one (apple-design review: an empty state needs a next step the person can take)", () => {
    const html = inContext(<YearsView years={[]} canManage={false} busy={null} onActivate={noop} />);
    expect(html).toContain("No year has been set up yet.");
    expect(html).not.toContain("Add the first one");
  });

  it("shows the shape of the page while it loads, and the add form to a whole-school Co-ordinator", () => {
    const html = inContext(<YearsScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Add a year<");
    expect(html).toContain(">Year (BS)<");
    expect(html).toContain(">First day<");
    expect(html).toContain(">Last day<");
    expect(html).toContain('inputMode="numeric"');
  });

  it("a section-scoped Co-ordinator and the Admin see no add form, and are told why in the school's words", () => {
    const section = inContext(<YearsScreen />, as("coordinator", "section", "plus2"));
    expect(section).not.toContain("Add a year");
    expect(section).toContain("whole school");
    expect(section).toContain("Vice Principal");
    const admin = inContext(<YearsScreen />, as("admin", "institution"));
    expect(admin).not.toContain("Add a year");
    expect(admin).toContain("only a Vice Principal can change it");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the programmes screen", () => {
  const programmes: Programme[] = [
    { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true }, { id: "l2", ordinal: 2, name: "Year 2", active: false }] },
    { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, gradingPolicy: null, levels: [] },
  ];
  const view = (canManage: boolean) => inContext(<ProgrammesView programmes={programmes} canManage={canManage} busy={null} onToggleProgramme={noop} onToggleLevel={noop} onAddLevel={async () => true} />);

  it("lists each programme with its section, affiliation and levels in order", () => {
    const html = view(false);
    expect(html).toContain(">BBS</h2>");
    expect(html).toContain(">TU<");
    expect(html.indexOf("Year 1")).toBeLessThan(html.indexOf("Year 2"));
    expect(html).toContain(">Switched off<");
    expect(html).toContain("No Levels yet.");
  });

  it("gives the change controls only to someone who can change things", () => {
    const html = view(true);
    expect(html).toContain('aria-label="Switch off BBS"');
    expect(html).toContain('aria-label="Switch on Old"');
    expect(html).toContain(">Level name<");
    expect(count(html, /<form/g)).toBeGreaterThanOrEqual(1);
    const readOnly = view(false);
    expect(readOnly).not.toContain("Switch off");
    expect(count(readOnly, /<form/g)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the classes screen", () => {
  const classes: SchoolClass[] = [
    { id: "c1", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "Morning", active: true },
    { id: "c2", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "", active: false },
  ];

  it("lists each class by programme, level and label, and marks one that is switched off", () => {
    const html = inContext(<ClassesView classes={classes} canManage busy={null} onToggle={noop} />);
    expect(html).toContain(">BBS · Year 1 (Morning)</h2>");
    expect(html).toContain(">BBS · Year 1</h2>");
    expect(html).toContain(">Switched off<");
    expect(html).toContain('aria-label="Switch off BBS · Year 1 (Morning)"');
    expect(inContext(<ClassesView classes={classes} canManage={false} busy={null} onToggle={noop} />)).not.toContain("Switch off BBS");
  });

  it("says so when the year has no classes", () => {
    expect(inContext(<ClassesView classes={[]} canManage busy={null} onToggle={noop} />)).toContain("No classes in this year yet.");
  });

  it("the form offers only active levels of active programmes", () => {
    const programmes: Programme[] = [
      { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true }, { id: "l2", ordinal: 2, name: "Year 2", active: false }] },
      { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, gradingPolicy: null, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true }] },
    ];
    const html = inContext(<ClassForm yearId="y" programmes={programmes} onAdded={noop} />);
    expect(html).toContain("BBS · Year 1");
    expect(html).not.toContain("Year 2");
    expect(html).not.toContain("Old · Grade 11");
    expect(html).toContain("Label (optional)");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the terminals screen", () => {
  const terminals: Terminal[] = [{ id: "t1", yearId: "y", name: "First terminal", ordinal: 1 }, { id: "t2", yearId: "y", name: "Second terminal", ordinal: 2 }];

  it("lists terminals in order, with their number", () => {
    const html = inContext(<TerminalsView terminals={terminals} />);
    expect(html.indexOf("First terminal")).toBeLessThan(html.indexOf("Second terminal"));
    expect(html).toContain("Number 1");
    expect(html).toContain("Number 2");
  });

  it("uses the school's word for the empty state", () => {
    expect(inContext(<TerminalsView terminals={[]} />)).toContain("No Exams in this year yet.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the pages", () => {
  it.each([
    ["years", SetupPage, "Academic years"],
    ["programmes", ProgrammesPage, "Programmes and Levels"],
    ["classes", ClassesPage, "Classes"],
    ["terminals", TerminalsPage, "Exams"],
  ] as const)("%s: a heading, the sub-menu, and the portal around it", (_name, Page, title) => {
    const html = inContext(<Page />);
    expect(html).toContain(`>${title}</h1>`);
    expect(html).toContain('aria-label="Setup sections"');
    expect(html).toContain("Skip to main content");
  });
});

// ---------------------------------------------------------------------------------------------
describe("sections, made by the Admin (D-095)", () => {
  const save = async () => true;
  const card = (sections: { key: string; name: string }[], canManage = true, prominent = sections.length === 0) =>
    inContext(<SectionsCard sections={sections} canManage={canManage} prominent={prominent} onAdd={save} onRename={save} />, as("admin", "institution"));

  it("a new school has none, and says so, with Add a Section as the page's one prominent button", () => {
    const html = card([]);
    expect(html).toContain("No Sections yet. Add the first one to start.");
    expect(html).toMatch(/<button[^>]*class="[^"]*\bprimary\b[^"]*\btrigger\b[^"]*"/);
    expect(html).toContain("for example Bachelor&#x27;s and Master&#x27;s, or Primary and High School");
  });

  it("lists each section with a Rename named for it; once there are sections, Add is no longer the prominent button", () => {
    const html = card(TEST_SECTIONS.royal);
    expect(html).toContain(">+2<");
    expect(html).toContain(">Bachelor&#x27;s<");
    expect(html).toContain('aria-label="Rename Bachelor&#x27;s"');
    // The buttons that open the pop-ups (the forms inside them have their own Save).
    const triggers = html.match(/<button[^>]*class="[^"]*\btrigger\b[^"]*"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(3); // Add, and a Rename for each
    expect(triggers.filter((b) => /\bprimary\b/.test(b))).toHaveLength(0);
  });

  it("someone who may only look sees the sections and no buttons", () => {
    const html = card(TEST_SECTIONS.royal, false);
    expect(html).toContain(">+2<");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<dialog");
  });
});
