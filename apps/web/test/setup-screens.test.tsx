import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SetupPage from "@/app/portal/setup/page";
import ProgrammesPage from "@/app/portal/setup/programmes/page";
import ClassesPage from "@/app/portal/setup/classes/page";
import TerminalsPage from "@/app/portal/setup/terminals/page";
import PromotionPage from "@/app/portal/setup/promotion/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SetupTabs } from "@/setup/SetupLayout";
import { ClassForm, ClassesView } from "@/setup/ClassesScreen";
import { AcademicStructureView, LengthForm, LevelForm, type Structure, type StructureActions } from "@/setup/ProgrammesScreen";
import { TerminalsView } from "@/setup/TerminalsScreen";
import { YearsScreen } from "@/setup/YearsScreen";
import { LevelPicker, TermsScreen, TermsTable, CloseCheckView } from "@/terms/TermsScreen";
import type { Term } from "@/terms/model";
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

const year = (id: string, label: string, status: Year["status"], levels: Term["levels"] = []): Year => ({
  id,
  bsYear: 2083,
  label,
  code: label.replace(/\W/g, "").slice(0, 10).toUpperCase() || "T1",
  startDate: "2026-04-14",
  endDate: "2027-04-13",
  startDateBs: "2083-01-01",
  endDateBs: "2083-12-30",
  status,
  levels,
  classes: 2,
  students: 40,
});
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
describe("academic terms (D-110)", () => {
  const sem = (id: string, name: string, programmeName = "BCA") => ({ id, name, ordinal: Number(id.slice(-1)), programmeId: "p", programmeName, sectionKey: "bachelors" });
  const terms = [year("t3", "BCA even", "draft"), year("t2", "BCA odd", "active", [sem("l1", "Semester 1"), sem("l3", "Semester 3")]), year("t1", "2082", "closed")];

  it("lists each term with its Nepali days, receipt code, levels and where it stands, in words", () => {
    const html = inContext(<TermsTable terms={terms} />);
    for (const label of ["BCA even", "BCA odd", "2082"]) expect(html).toContain(`<span>${label}</span>`);
    expect(html).toContain("1 Baisakh 2083");
    expect(html).toContain("Receipt code BCAODD");
    expect(html).toContain("BCA: Semester 1, Semester 3");
    for (const word of [">Open<", ">Closed<", ">Not started<"]) expect(html).toContain(word);
    expect(html).not.toContain("Manage"); // read only without an action
  });

  it("offers Manage on every row only where something can be done, and says so when there is none", () => {
    expect(inContext(<TermsTable terms={terms} onOpen={noop} />)).toContain('aria-label="Manage BCA odd"');
    expect(inContext(<TermsTable terms={[]} onOpen={noop} />)).toContain("Add the first one");
    expect(inContext(<TermsTable terms={[]} />)).toContain("No term has been set up yet.");
  });

  it("the level picker shows a level another open term runs, but does not offer it", () => {
    const programmes = [
      { id: "p", key: "bca", name: "BCA", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, students: 0, canDelete: false, levels: [1, 2, 3, 4].map((i) => ({ id: `l${i}`, ordinal: i, name: `Semester ${i}`, active: true, usualMonths: 6, students: 0, canDelete: false })) },
    ] as Programme[];
    const html = inContext(<LevelPicker programmes={programmes} taken={new Map([["l1", "BCA odd"]])} value={["l2"]} onChange={noop} />);
    expect(html).toContain("In BCA odd");
    expect(count(html, /disabled=""/g)).toBe(1);
    expect(count(html, /checked=""/g)).toBe(1);
    expect(html).toContain('aria-label="Choose the odd levels of BCA"');
  });

  it("what stops a term from closing is said class by class, exam by exam", () => {
    const html = inContext(<CloseCheckView check={{ ready: false, exams: 1, classes: 2, missing: [{ classId: "c1", className: "BCA · Semester 1 (A)", examId: "e1", examName: "Final" }, { classId: "c2", className: "BCA · Semester 3 (A)", examId: null, examName: null }] }} />);
    expect(html).toContain("BCA · Semester 1 (A): Final");
    expect(html).toContain("BCA · Semester 3 (A): this term has no exams yet");
    expect(inContext(<CloseCheckView check={{ ready: true, exams: 1, classes: 2, missing: [] }} />)).toContain("The term can close");
  });

  it("the Co-ordinator reads the terms in Setup, told who changes them; the Principal's page shows its shape while it loads", () => {
    const setup = inContext(<YearsScreen />);
    expect(setup).toMatch(/aria-busy="true"/);
    expect(setup).toContain("The Principal makes, opens and closes terms");
    expect(setup).not.toContain("New term");
    const principal = inContext(<TermsScreen />, as("admin", "institution"));
    expect(principal).toContain(">Academic terms<");
    expect(principal).toMatch(/aria-busy="true"/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Academic Structure (D-095, D-096)", () => {
  const level = (id: string, ordinal: number, name: string, students: number, active = true, canDelete = students === 0) => ({ id, ordinal, name, active, usualMonths: null, students, canDelete });
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
    setLevelLength: async () => true,
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

  it("a level with no length says so, and a level with one shows it (D-114)", () => {
    expect(html).toContain("Length not set");
    const withLength = view({ ...structure, programmes: [{ ...structure.programmes[0]!, levels: [{ ...level("l1", 1, "1st Year", 80), usualMonths: 12 }] }] });
    expect(withLength).toContain("80 Students · 12 months");
    expect(withLength).not.toContain("Length not set");
  });

  it("adding a level asks for its name and its length in months, both required (D-114)", () => {
    const form = inContext(<LevelForm submitLabel="Add a Level" onSave={async () => true} />, as("admin", "institution"));
    expect(form).toContain(">Level name<");
    expect(form).toContain(">Length (months)<");
    expect(form).toContain("A term takes only levels of its own length");
    const edit = inContext(<LengthForm initial={6} onSave={async () => true} />, as("admin", "institution"));
    expect(edit).toContain(">Length (months)<");
    expect(edit).toContain('value="6"');
  });

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
    expect(html).toContain("This can&#x27;t be deleted while it has Programmes, staff or receipts linked to it.");
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

  it("says so when the term has no classes", () => {
    expect(inContext(<ClassesView classes={[]} canManage busy={null} onToggle={noop} />)).toContain("No classes in this term yet.");
  });

  it("the form offers only active levels of active programmes", () => {
    const programmes: Programme[] = [
      { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true, usualMonths: null, students: 0, canDelete: false }, { id: "l2", ordinal: 2, name: "Year 2", active: false, usualMonths: null, students: 0, canDelete: false }] },
      { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, gradingPolicy: null, students: 0, canDelete: false, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true, usualMonths: null, students: 0, canDelete: false }] },
    ];
    const html = inContext(<ClassForm yearId="y" programmes={programmes} onAdded={noop} />);
    expect(html).toContain("BBS · Year 1");
    expect(html).not.toContain("Year 2");
    expect(html).not.toContain("Old · Grade 11");
    expect(html).toContain("Section (optional)");
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
    expect(inContext(<TerminalsView terminals={[]} />)).toContain("No Exams in this term yet.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the pages", () => {
  it.each([
    ["terms", SetupPage, "Academic terms"],
    ["promotion", PromotionPage, "Move students on"],
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
