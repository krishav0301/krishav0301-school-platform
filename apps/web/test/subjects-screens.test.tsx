import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CurriculumPage from "@/app/portal/setup/curriculum/page";
import SubjectsPage from "@/app/portal/setup/subjects/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { CurriculumView, GroupForm, OfferingForm, PaperForm, SubjectPanel, readPaper } from "@/setup/CurriculumScreen";
import { SetupTabs } from "@/setup/SetupLayout";
import { SubjectEditForm, SubjectForm, SubjectsBoard, SubjectsScreen, groupSubjects } from "@/setup/SubjectsScreen";
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

const subject = (id: string, name: string, over: Partial<Subject> = {}): Subject => ({ id, name, code: null, archived: false, sectionKey: "plus2", inCurriculum: false, ...over });

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

  const wings = TEST_SECTIONS.royal;
  const board = (props: Partial<React.ComponentProps<typeof SubjectsBoard>> = {}) =>
    inContext(<SubjectsBoard subjects={subjects} wings={wings} canArchive busy={null} onToggle={noop} {...props} />);

  it("groups the subjects by wing in the school's order, an old one with no wing last, and filters by search and status", () => {
    const all = [subject("s1", "English"), subject("s2", "English", { sectionKey: "bachelors" }), subject("s3", "Music", { sectionKey: null }), subject("s4", "Physics", { code: "PHY", archived: true })];
    const { groups, filtered } = groupSubjects(all, wings, "", "");
    expect(filtered).toBe(false);
    expect(groups.map((g) => g.key)).toEqual([wings[0]!.key, wings[1]!.key, ""]);
    expect(groups[0]!.subjects.map((s) => s.name)).toEqual(["English", "Physics"]);
    expect(groups[2]!.subjects.map((s) => s.name)).toEqual(["Music"]);
    const byCode = groupSubjects(all, wings, " phy ", "");
    expect(byCode.filtered).toBe(true);
    expect(byCode.groups.map((g) => g.key)).toEqual([wings[0]!.key]); // a wing with no match is left out while filtering
    expect(groupSubjects(all, wings, "", "archived").groups[0]!.subjects.map((s) => s.name)).toEqual(["Physics"]);
    expect(groupSubjects(all, wings, "", "inUse").groups.flatMap((g) => g.subjects.map((s) => s.name))).toEqual(["English", "English", "Music"]);
    // Nothing filtered: a wing with no subjects is still there, for its Add button.
    expect(groupSubjects([subject("s1", "English")], wings, "", "").groups).toHaveLength(2);
  });

  it("is one card per wing with its name and a count; the first opens to its table, the others stay closed", () => {
    const html = board({ subjects: [subject("s1", "Biology", { code: "BIO" }), subject("s2", "Physics", { archived: true }), subject("s3", "English", { sectionKey: "bachelors" })] });
    expect(html).toContain(">+2<");
    expect(html).toContain(">Bachelor&#x27;s<");
    expect(html).toContain("2 subjects");
    expect(html).toContain("1 subject<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
    for (const name of ["Biology", "Physics"]) expect(html).toContain(`data-primary="true">${name}</td>`);
    expect(html).not.toContain("English"); // the second wing is closed
    expect(html).toContain('data-label="Code">BIO<');
  });

  it("a search opens every wing that has a match", () => {
    const html = board({ subjects: [subject("s1", "English"), subject("s2", "English", { sectionKey: "bachelors" })], q: "eng" });
    expect(count(html, /aria-expanded="true"/g)).toBe(2);
    expect(count(html, /data-primary="true">English</g)).toBe(2);
    expect(board({ q: "zzz" })).toContain("No subjects match.");
  });

  it("says In use or Archived in words, and offers Archive and Restore naming their subject only to someone who may change one", () => {
    const html = board();
    expect(html).toContain(">In use<");
    expect(count(html, />Archived</g)).toBe(1);
    expect(html).toContain('aria-label="Archive Biology"');
    expect(html).toContain('aria-label="Restore Physics"');
    const readOnly = board({ canArchive: false });
    expect(readOnly).not.toContain("Archive Biology");
    expect(readOnly).not.toContain("Restore Physics");
    expect(readOnly).not.toContain(">Actions<");
  });

  it("names a subject with no wing in a group of its own, and Edit is on every subject for someone who may change one (FUT point 17)", () => {
    const html = board({ subjects: [subject("s1", "English"), subject("s3", "Music", { sectionKey: null })], onEdit: async () => true as const, q: "m" });
    expect(html).toContain("No Section yet");
    expect(html).toContain('aria-label="Edit Music"');
    const two = board({ subjects: [subject("s1", "English"), subject("s2", "Maths")], onEdit: async () => true as const });
    expect(count(two, /aria-label="Edit /g)).toBe(2);
  });

  it("each wing card can add to its own wing, for the wings the person reaches, in the school's word", () => {
    const html = board({ canAdd: true, addableWings: [wings[0]!.key] });
    expect(count(html, />Add subject to this section</g)).toBe(1);
    expect(board({ canAdd: false, addableWings: [wings[0]!.key] })).not.toContain("Add subject to this");
  });

  it("the add form asks for the wing first, or says the one wing a person reaches (D-114)", () => {
    const both = inContext(<SubjectForm onAdded={noop} wings={TEST_SECTIONS.royal} />);
    expect(both).toContain(">Section<");
    expect(both).toContain(">+2<");
    const one = inContext(<SubjectForm onAdded={noop} wings={[TEST_SECTIONS.royal[0]!]} />);
    expect(one).toContain("In +2");
    expect(one).not.toContain("<select");
  });

  it("Edit changes the name, the code, and the wing while no curriculum uses the subject (FUT point 17)", () => {
    const free = inContext(<SubjectEditForm subject={subject("s1", "Physics", { code: "PHY" })} wings={TEST_SECTIONS.royal} onSave={async () => true as const} />);
    for (const label of [">Name<", ">Code (optional)<", ">Section<"]) expect(free).toContain(label);
    expect(free).toContain('value="Physics"');
    expect(free).toContain('value="PHY"');
    expect(free).not.toMatch(/<select[^>]*disabled/);
    const used = inContext(<SubjectEditForm subject={subject("s1", "Physics", { inCurriculum: true })} wings={TEST_SECTIONS.royal} onSave={async () => true as const} />);
    expect(used).toMatch(/<select[^>]*disabled/);
    expect(used).toContain("A curriculum uses this subject, so its Section stays.");
  });

  it("an empty catalogue invites adding only to someone who can add", () => {
    expect(inContext(<SubjectsBoard subjects={[]} wings={wings} canArchive busy={null} onToggle={noop} canAdd />)).toContain("Add the first one");
    const read = inContext(<SubjectsBoard subjects={[]} wings={wings} canArchive={false} busy={null} onToggle={noop} canAdd={false} />);
    expect(read).toContain("No subject has been added yet.");
    expect(read).not.toContain("Add the first one");
  });

  it("the add form has a visible label for the name and the code", () => {
    const html = inContext(<SubjectForm onAdded={noop} wings={TEST_SECTIONS.royal} />);
    expect(html).toContain(">Add a subject<");
    expect(html).toContain(">Name<");
    expect(html).toContain(">Code (optional)<");
    expect(html).toContain("A short code such as MATH.");
  });

  it("a whole-school Co-ordinator can add and archive; a +2 Co-ordinator can add but is told renaming needs the whole school; the Admin only looks", () => {
    const whole = inContext(<SubjectsScreen />);
    expect(whole).toContain(">Add a subject<");
    expect(whole).toContain("Search subjects...");
    expect(whole).toContain(">Status<");
    expect(whole).toContain("Subjects are created here and assigned to levels from the Curriculum screen.");
    expect(whole).not.toContain("needs a Vice Principal for the whole school");
    expect(whole).toMatch(/role="status"[^>]*aria-busy="true"/);

    const section = inContext(<SubjectsScreen />, as("coordinator", "section", "plus2"));
    expect(section).toContain(">Add a subject<");
    expect(section).toContain("needs a Vice Principal for the whole school");
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
    level: { id: "l1", name: "Grade 11", programmeId: "p1", programmeName: "+2 Science", sectionKey: "plus2" },
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

    const offering = inContext(<OfferingForm levelId="l1" sectionKey="plus2" subjects={[subject("s9", "Chemistry", { code: "CHE" }), subject("s1", "Biology", { archived: true })]} offerings={[biology]} groups={curriculum.groups} onAdded={noop} />);
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
    const html = inContext(<OfferingForm levelId="l1" sectionKey="plus2" subjects={[]} offerings={[]} groups={[]} onAdded={noop} />);
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
