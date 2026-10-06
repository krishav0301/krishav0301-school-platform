import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CurriculumPage from "@/app/portal/setup/curriculum/page";
import SubjectsPage from "@/app/portal/setup/subjects/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { CurriculumView, GroupForm, OfferingForm, PaperForm, SubjectPanel, readPaper } from "@/setup/CurriculumScreen";
import { SetupTabs } from "@/setup/SetupLayout";
import { SubjectForm, SubjectsScreen, SubjectsView } from "@/setup/SubjectsScreen";
import type { Curriculum, Offering, Subject } from "@/setup/model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/setup/subjects", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

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
const noop = () => {};

const subject = (id: string, name: string, over: Partial<Subject> = {}): Subject => ({ id, name, code: null, archived: false, ...over });

// ---------------------------------------------------------------------------------------------
describe("the sub-menu", () => {
  it("has six screens now, and marks the curriculum current on its own address", () => {
    const html = inContext(<SetupTabs pathname="/portal/setup/curriculum" />);
    for (const href of ["/portal/setup", "/portal/setup/programmes", "/portal/setup/classes", "/portal/setup/terminals", "/portal/setup/subjects", "/portal/setup/curriculum"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Curriculum</);
    expect(html).toContain(">Subjects<");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the subjects screen", () => {
  const subjects = [subject("s1", "Biology", { code: "BIO" }), subject("s2", "Physics", { archived: true }), subject("s3", "English")];

  it("lists each subject with its code, and marks an archived one in words", () => {
    const html = inContext(<SubjectsView subjects={subjects} canArchive busy={null} onToggle={noop} />);
    for (const name of ["Biology", "Physics", "English"]) expect(html).toContain(`data-primary="true">${name}</td>`);
    expect(html).toContain('data-label="Code">BIO<');
    expect(html).toContain(">Archived<");
    expect(count(html, />Archived</g)).toBe(1);
  });

  it("offers Archive and Restore, each naming its subject, only to someone who may change a subject", () => {
    const html = inContext(<SubjectsView subjects={subjects} canArchive busy={null} onToggle={noop} />);
    expect(html).toContain('aria-label="Archive Biology"');
    expect(html).toContain('aria-label="Restore Physics"');
    const readOnly = inContext(<SubjectsView subjects={subjects} canArchive={false} busy={null} onToggle={noop} />);
    expect(readOnly).not.toContain("Archive Biology");
    expect(readOnly).not.toContain("Restore Physics");
  });

  it("an empty catalogue invites adding only to someone who can add", () => {
    expect(inContext(<SubjectsView subjects={[]} canArchive busy={null} onToggle={noop} canAdd />)).toContain("Add the first one");
    const read = inContext(<SubjectsView subjects={[]} canArchive={false} busy={null} onToggle={noop} canAdd={false} />);
    expect(read).toContain("No subject has been added yet.");
    expect(read).not.toContain("Add the first one");
  });

  it("the add form has a visible label for the name and the code", () => {
    const html = inContext(<SubjectForm onAdded={noop} />);
    expect(html).toContain(">Add a subject<");
    expect(html).toContain(">Name<");
    expect(html).toContain(">Code (optional)<");
    expect(html).toContain("A short code such as MATH.");
  });

  it("a whole-school Co-ordinator can add and archive; a +2 Co-ordinator can add but is told renaming needs the whole school; the Admin only looks", () => {
    const whole = inContext(<SubjectsScreen />);
    expect(whole).toContain(">Add a subject<");
    expect(whole).not.toContain("changes it for every section");
    expect(whole).toMatch(/role="status"[^>]*aria-busy="true"/);

    const section = inContext(<SubjectsScreen />, as("coordinator", "section", "plus2"));
    expect(section).toContain(">Add a subject<");
    expect(section).toContain("changes it for every section");
    expect(section).toContain("Vice Principal for the whole school");

    const admin = inContext(<SubjectsScreen />, as("admin", "institution"));
    expect(admin).not.toContain(">Add a subject<");
    expect(admin).toContain("Read only. The Vice Principal manages this.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the curriculum screen", () => {
  const biology: Offering = {
    id: "o1",
    subject: subject("s1", "Biology", { code: "BIO" }),
    creditHundredths: 375,
    group: { id: "g1", name: "Science option" },
    active: true,
    fullMarksHundredths: 10000,
    practicalHundredths: 2500,
  };
  const english: Offering = { id: "o2", subject: subject("s2", "English"), creditHundredths: null, group: null, active: false, fullMarksHundredths: 10000, practicalHundredths: null };
  const curriculum: Curriculum = {
    level: { id: "l1", name: "Grade 11", programmeId: "p1", programmeName: "+2 Science" },
    groups: [{ id: "g1", name: "Science option", pickCount: 1, active: true }, { id: "g2", name: "Old option", pickCount: 2, active: false }],
    offerings: [biology, english],
  };
  const view = (canManage: boolean, data: Curriculum = curriculum) =>
    inContext(<CurriculumView curriculum={data} canManage={canManage} busy={null} onToggleGroup={noop} onToggleOffering={noop} onSetGroup={noop} />);

  it("a reader sees the Principal's table: subjects, credit hours and marks as decimals, and electives in words", () => {
    const html = view(false);
    expect(html).toContain('data-primary="true">Biology</td>');
    expect(html).toContain(">3.75<");
    expect(html).toContain("Out of 100: theory 75, practical 25");
    expect(html).toContain("Choose 1 of: Biology");
    expect(html).not.toContain("English"); // switched off: not taught, so not shown to a reader
    expect(count(html, /<form/g)).toBe(0);
    expect(count(html, /<button/g)).toBe(0);
    expect(count(html, /<select/g)).toBe(0);
  });

  it("for the Co-ordinator: every subject in a table with its paper, elective and status in words, each with Edit", () => {
    const html = view(true);
    expect(html).toContain('data-primary="true">Biology (BIO)</td>');
    expect(html).toContain(">3.75<");
    expect(html).toContain("Out of 100: theory 75, practical 25");
    expect(html).toContain("Out of 100<"); // English: no practical
    expect(html).toContain(">Science option<"); // Biology's elective group
    expect(html).toContain(">Compulsory<");
    expect(html).toContain(">In use<");
    expect(count(html, />Switched off</g)).toBeGreaterThanOrEqual(2); // English, and the old group
    expect(html).toContain('aria-label="Edit Biology"');
    expect(html).toContain('aria-label="Edit English"');
  });

  it("the elective groups, each with what it offers in words and its switch, and Add as a second, quieter button", () => {
    const html = view(true);
    expect(html).toContain(">Science option</h3>");
    expect(html).toContain("Choose 1 of: Biology");
    expect(html).toContain("Pick 2"); // the old group has no subjects
    expect(html).toContain('aria-label="Switch off Science option"');
    expect(html).toContain('aria-label="Switch on Old option"');
    const trigger = html.slice(html.lastIndexOf("<button", html.indexOf("Add an elective group</button>")), html.indexOf("Add an elective group</button>"));
    expect(trigger).toContain("secondary");
  });

  it("a subject's panel: its facts, its elective group, its paper with a form to change it, and Switch off", () => {
    const html = inContext(<SubjectPanel curriculum={curriculum} offering={biology} busy={null} onClose={noop} onToggleOffering={noop} onSetGroup={noop} onChanged={noop} />);
    expect(html).toContain(">Biology</h2>");
    expect(html).toContain("+2 Science · Grade 11");
    expect(html).toContain(">BIO<");
    expect(html).toContain("Elective group for Biology");
    expect(html).toContain("None: everyone takes it");
    expect(html).not.toContain(">Old option<"); // a switched-off group cannot be chosen
    expect(html).toContain("Out of 100: theory 75, practical 25");
    expect(html).toContain("This subject has a practical");
    expect(html).toContain(">Practical marks<");
    expect(html).toContain("Save paper");
    expect(html).toContain('aria-label="Switch off Biology"');
    expect(count(html, /<form/g)).toBe(1);
  });

  it("says so when a level has no groups and no subjects", () => {
    const html = view(true, { ...curriculum, groups: [], offerings: [] });
    expect(html).toContain("No elective groups.");
    expect(html).toContain("No subjects on this Level yet.");
  });

  it("the forms have visible labels, a number keypad for decimals, and hints", () => {
    const group = inContext(<GroupForm levelId="l1" onAdded={noop} />);
    expect(group).toContain(">Add an elective group<");
    expect(group).toContain(">Group name<");
    expect(group).toContain(">How many to pick<");
    expect(group).toContain('inputMode="numeric"');

    const offering = inContext(<OfferingForm levelId="l1" subjects={[subject("s9", "Chemistry", { code: "CHE" }), subject("s1", "Biology", { archived: true })]} offerings={[biology]} groups={curriculum.groups} onAdded={noop} />);
    expect(offering).toContain(">Add a subject to this Level<");
    expect(offering).toContain("Chemistry (CHE)");
    expect(offering).not.toContain("Biology (");
    expect(offering).toContain(">Credit hours (optional)<");
    expect(offering).toContain('inputMode="decimal"');
    expect(offering).toContain("Science option"); // an active group can be chosen
    expect(offering).not.toContain("Old option"); // a switched-off group cannot

    // The paper: full marks (100 to start), "This subject has a practical", and its marks only once ticked.
    expect(offering).toContain(">Full marks<");
    expect(offering).toContain('value="100"');
    expect(offering).toContain("This subject has a practical");
    expect(offering).not.toContain(">Practical marks<");
    const paper = inContext(<PaperForm offering={biology} onSaved={noop} />);
    expect(paper).toContain(">Practical marks<");
    expect(paper).toContain('value="25"');
  });

  it("reads a paper: whole hundredths, the practical only when ticked, and less than the full marks", () => {
    expect(readPaper({ full: "100", hasPractical: true, practical: "25" })).toEqual({ ok: true, fullMarksHundredths: 10000, practicalHundredths: 2500 });
    expect(readPaper({ full: "75", hasPractical: false, practical: "99" })).toEqual({ ok: true, fullMarksHundredths: 7500, practicalHundredths: null });
    expect(readPaper({ full: "100", hasPractical: true, practical: "100" })).toMatchObject({ ok: false, errors: { practical: "setup.error.practicalInvalid" } });
    expect(readPaper({ full: "0", hasPractical: false, practical: "" })).toMatchObject({ ok: false, errors: { full: "setup.error.fullMarksInvalid" } });
    expect(readPaper({ full: "100", hasPractical: true, practical: "" })).toMatchObject({ ok: false, errors: { practical: "setup.error.practicalInvalid" } });
  });

  it("the offering form says so when there is nothing left to add", () => {
    const html = inContext(<OfferingForm levelId="l1" subjects={[]} offerings={[]} groups={[]} onAdded={noop} />);
    expect(html).toContain("Every subject is already on this Level, or none has been added yet.");
    expect(html).not.toContain("<form");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the pages", () => {
  it.each([
    ["subjects", SubjectsPage, "Subjects"],
    ["curriculum", CurriculumPage, "Curriculum"],
  ] as const)("%s: a heading, the sub-menu, and the portal around it", (_name, Page, title) => {
    const html = inContext(<Page />);
    expect(html).toContain(`>${title}</h1>`);
    expect(html).toContain('aria-label="Setup sections"');
    expect(html).toContain("Skip to main content");
  });
});
