import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SetupPage from "@/app/portal/setup/page";
import ProgrammesPage from "@/app/portal/setup/programmes/page";
import ClassesPage from "@/app/portal/setup/classes/page";
import TerminalsPage from "@/app/portal/setup/terminals/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SetupTabs } from "@/setup/SetupLayout";
import { ClassForm, ClassesView } from "@/setup/ClassesScreen";
import { AcademicStructureView, type Structure, type StructureActions } from "@/setup/ProgrammesScreen";
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
  terms: { "term.programme": "Programme", "term.level": "Level", "term.section": "Section", "term.terminal": "Exam", "role.coordinator": "Vice Principal", "role.student": "Student" },
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
    for (const label of ["2084", "2083", "2082"]) expect(html).toContain(`data-primary="true">${label}</td>`);
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
    expect(admin).toContain("Read only. The Vice Principal manages this.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Academic Structure (D-095, D-096)", () => {
  const level = (id: string, ordinal: number, name: string, students: number, active = true, canDelete = students === 0) => ({ id, ordinal, name, active, students, canDelete });
  const structure: Structure = {
    sections: [
      { key: "s1", name: "Bachelor of Engineering", active: true, receiptCode: "BE", receiptCodeLocked: true, canDelete: false },
      { key: "s2", name: "School", active: true, receiptCode: "SCH", receiptCodeLocked: false, canDelete: false },
      { key: "s3", name: "Master's", active: true, receiptCode: null, receiptCodeLocked: false, canDelete: false },
    ],
    programmes: [
      { id: "p1", key: "cse", name: "Computer Science", section: { key: "s1", name: "Bachelor of Engineering" }, affiliation: "TU", active: true, gradingPolicy: "percentage_division", students: 158, canDelete: false, levels: [level("l1", 1, "1st Year", 80), level("l2", 2, "2nd Year", 78), level("l3", 3, "3rd Year", 0, false)] },
      { id: "p2", key: "mech", name: "Mechanical", section: { key: "s1", name: "Bachelor of Engineering" }, affiliation: "TU", active: true, gradingPolicy: null, students: 1, canDelete: false, levels: [level("l4", 1, "1st Year", 1)] },
      { id: "p3", key: "pri", name: "Primary School", section: { key: "s2", name: "School" }, affiliation: "CDC", active: false, gradingPolicy: null, students: 0, canDelete: false, levels: [] },
    ],
    totals: { sections: 3, programmes: 2, levels: 3, students: 1248 },
  };
  const actions: StructureActions = {
    addSection: async () => true,
    editSection: async () => true,
    addProgramme: async () => true,
    editProgramme: async () => true,
    setProgrammeActive: async () => true,
    addLevel: async () => true,
    renameLevel: async () => true,
    setLevelActive: async () => true,
    setSectionActive: async () => true,
    deleteSection: async () => true,
    deleteProgramme: async () => true,
    deleteLevel: async () => true,
  };
  const view = (data: Structure, canManage = true) => inContext(<AcademicStructureView data={data} canManage={canManage} actions={actions} />, as(canManage ? "admin" : "coordinator", "institution"));
  const html = view(structure);

  it("shows the four figures the server worked out, formatted, in the school's own words", () => {
    for (const label of ["Total Sections", "Total Programmes", "Total Levels", "Total Students"]) expect(html).toContain(label);
    expect(html).toContain(">1,248<");
    expect(html).toMatch(/<dt[^>]*>Total Sections<\/dt><dd[^>]*>3<\/dd>/);
  });

  it("each section names its programmes, levels switched on and students, worked out from its programmes", () => {
    expect(html).toContain("Bachelor of Engineering");
    expect(html).toContain("2 Programmes · 3 Levels · 159 Students");
    expect(html).toContain("0 Programmes · 0 Levels · 0 Students"); // School: its one programme is switched off
  });

  it("the first section and its first programme start open; the others are closed and say so", () => {
    expect(html).toContain('aria-label="Hide Bachelor of Engineering"');
    expect(html).toContain('aria-label="Hide Computer Science"');
    expect(html).toContain('aria-label="Show Mechanical"');
    expect(html).toContain('aria-label="Show School"');
    expect(html).toContain("1st Year");
    expect(html).toContain("80 Students");
    expect(html).not.toContain("Primary School"); // inside a closed section
    expect(count(html, /aria-expanded="true"/g)).toBe(2);
  });

  it("the hierarchy is in the headings: the section is a level-2 heading, its programmes level 3, then their levels", () => {
    expect(html).toMatch(/<h2[^>]*>Bachelor of Engineering<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Computer Science<\/h3>/);
    expect(html).toMatch(/<h4[^>]*>Levels<\/h4>/);
  });

  it("a programme shows its affiliation, grading and levels; a level switched off says so", () => {
    expect(html).toContain(">TU<");
    expect(html).toContain("2 Levels · 158 Students · Percentage and division");
    expect(html).toContain(">Switched off<");
    expect(html).toContain("1 Level · 1 Student · Not set"); // one, not "1 Students"
  });

  it("the Admin gets Rename, Edit, Add Programme, Add Level and each level's options, all named for what they act on", () => {
    expect(html).toContain('aria-label="Edit Bachelor of Engineering"');
    expect(html).toContain('aria-label="Edit Computer Science"');
    expect(html).toContain("Add a Programme");
    expect(html).toContain("Add a Level");
    expect(html).toContain("Options for 1st Year");
    // None of them is the page's prominent button: that is Add a Section, at the top of the screen (D-030).
    const triggers = html.match(/<button[^>]*class="[^"]*\btrigger\b[^"]*"[^>]*>/g) ?? [];
    expect(triggers.length).toBeGreaterThan(4);
    expect(triggers.filter((b) => /\bprimary\b/.test(b))).toHaveLength(0);
  });

  it("someone who may only look sees the same structure and no change controls", () => {
    const readOnly = view(structure, false);
    expect(readOnly).toContain("Bachelor of Engineering");
    expect(readOnly).toContain("80 Students");
    expect(readOnly).not.toContain("<dialog");
    expect(readOnly).not.toContain(">Edit<");
  });

  it("each section shows its receipt code; its Edit offers the code until receipts are issued, then shows it fixed (D-102, admin FUT F-18)", () => {
    expect(html).toContain("Receipt code BE");
    expect(html).toContain("Receipt code BE. It is fixed: receipts have been issued with it.");
    // School's code may still change: a field holding it, with an example number.
    expect(html).toMatch(/<input[^>]*value="SCH"/);
    expect(html).toContain("Receipt numbers start with it, such as SCH-2083-00001. 2 to 6 letters or digits.");
    // A section from before codes says it has none yet.
    expect(html).toContain("Not set yet: receipts use an internal code until you give one. Once given, it is fixed.");
  });

  it("a school with no sections says what to do first", () => {
    const empty = view({ sections: [], programmes: [], totals: { sections: 0, programmes: 0, levels: 0, students: 0 } });
    expect(empty).toContain("No Sections yet");
    expect(empty).toContain("Create your first section to start building your academic structure.");
  });

  it("a section with no programmes, and a programme with no levels, say so", () => {
    const bare = view({
      sections: [{ key: "s1", name: "Master's", active: true, receiptCode: null, receiptCodeLocked: false, canDelete: false }],
      programmes: [{ id: "p9", key: "me", name: "ME Civil", section: { key: "s1", name: "Master's" }, affiliation: "TU", active: true, gradingPolicy: null, students: 0, canDelete: false, levels: [] }],
      totals: { sections: 1, programmes: 1, levels: 0, students: 0 },
    });
    expect(bare).toContain("No Levels yet.");
    const none = view({ sections: [{ key: "s1", name: "Master's", active: true, receiptCode: null, receiptCodeLocked: false, canDelete: false }], programmes: [], totals: { sections: 1, programmes: 0, levels: 0, students: 0 } });
    expect(none).toContain("No Programmes in this section yet.");
  });

  it("Delete is offered only where nothing is attached; elsewhere the Edit says why and to switch it off instead (D-097)", () => {
    // 1st Year has 80 students: no Delete, the reason instead. 3rd Year has none: Delete, named for it.
    expect(html).toContain('aria-label="Delete 3rd Year"');
    expect(html).not.toContain('aria-label="Delete 1st Year"');
    expect(html).toContain("This can&#x27;t be deleted while it has classes, subjects, fees or applications. Switch it off instead: nothing is lost.");
    // The sections in the fixture are all in use: each says so inside its Edit.
    expect(html).toContain("This can&#x27;t be deleted while it has programmes, staff or receipts linked to it.");
    expect(html).not.toContain("Yes, delete"); // it asks once more only after Delete is pressed
  });

  it("an empty section offers Delete, and a switched-off one says so and takes no new programmes", () => {
    const off = view({
      sections: [{ key: "s1", name: "Evening", active: false, receiptCode: null, receiptCodeLocked: false, canDelete: true }],
      programmes: [],
      totals: { sections: 1, programmes: 0, levels: 0, students: 0 },
    });
    expect(off).toContain('aria-label="Delete Evening"');
    expect(off).toContain(">Switched off<");
    expect(off).toContain('aria-label="Switch on Evening"');
    expect(off).not.toContain("Add a Programme");
  });

  it("carries no colour of its own", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the classes screen", () => {
  const classes: SchoolClass[] = [
    { id: "c1", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "Morning", active: true, canDelete: false },
    { id: "c2", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "", active: false, canDelete: true },
  ];

  it("lists each class by programme, level and label, and marks one that is switched off", () => {
    const html = inContext(<ClassesView classes={classes} canManage busy={null} onToggle={noop} />);
    expect(html).toContain("data-primary=\"true\">BBS · Year 1 (Morning)</td>");
    expect(html).toContain("data-primary=\"true\">BBS · Year 1</td>");
    expect(html).toContain(">Switched off<");
    expect(html).toContain('aria-label="Switch off BBS · Year 1 (Morning)"');
    expect(inContext(<ClassesView classes={classes} canManage={false} busy={null} onToggle={noop} />)).not.toContain("Switch off BBS");
  });

  it("offers Delete only on a class nothing is attached to, and only to someone who can change classes (D-097)", () => {
    const html = inContext(<ClassesView classes={classes} canManage busy={null} onToggle={noop} onDelete={async () => true} />);
    expect(html).toContain('aria-label="Delete BBS · Year 1"');
    expect(html).not.toContain('aria-label="Delete BBS · Year 1 (Morning)"');
    expect(inContext(<ClassesView classes={classes} canManage={false} busy={null} onToggle={noop} onDelete={async () => true} />)).not.toContain("Delete");
  });

  it("says so when the year has no classes", () => {
    expect(inContext(<ClassesView classes={[]} canManage busy={null} onToggle={noop} />)).toContain("No classes in this year yet.");
  });

  it("the form offers only active levels of active programmes", () => {
    const programmes: Programme[] = [
      { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true, students: 0, canDelete: false }, { id: "l2", ordinal: 2, name: "Year 2", active: false, students: 0, canDelete: false }] },
      { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true, students: 0, canDelete: false }] },
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
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
  });

  it("uses the school's word for the empty state", () => {
    expect(inContext(<TerminalsView terminals={[]} />)).toContain("No Exams in this year yet.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the pages", () => {
  it.each([
    ["years", SetupPage, "Academic years"],
    ["programmes", ProgrammesPage, "Academic Structure"],
    ["classes", ClassesPage, "Classes"],
    ["terminals", TerminalsPage, "Exams"],
  ] as const)("%s: a heading, the sub-menu, and the portal around it", (_name, Page, title) => {
    const html = inContext(<Page />);
    expect(html).toContain(`>${title}</h1>`);
    expect(html).toContain('aria-label="Setup sections"');
    expect(html).toContain("Skip to main content");
  });
});
