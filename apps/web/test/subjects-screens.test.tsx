import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CurriculumPage from "@/app/portal/setup/curriculum/page";
import SubjectsPage from "@/app/portal/setup/subjects/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ComponentForm, CurriculumView, GroupForm, OfferingForm } from "@/setup/CurriculumScreen";
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
    components: [
      { id: "c1", name: "Theory", maxHundredths: 7500, kind: "theory", ordinal: 1, active: true },
      { id: "c2", name: "Practical", maxHundredths: 2550, kind: "practical", ordinal: 2, active: false },
    ],
  };
  const english: Offering = { id: "o2", subject: subject("s2", "English"), creditHundredths: null, group: null, active: false, components: [] };
  const curriculum: Curriculum = {
    level: { id: "l1", name: "Grade 11", programmeId: "p1", programmeName: "+2 Science" },
    groups: [{ id: "g1", name: "Science option", pickCount: 1, active: true }, { id: "g2", name: "Old option", pickCount: 2, active: false }],
    offerings: [biology, english],
  };
  const view = (canManage: boolean, data: Curriculum = curriculum) =>
    inContext(<CurriculumView curriculum={data} canManage={canManage} busy={null} onToggleGroup={noop} onToggleOffering={noop} onSetGroup={noop} onToggleComponent={noop} />);

  it("shows the level's groups, subjects, credit hours as decimals, marks as decimals, and what is switched off, in words", () => {
    const html = view(false);
    expect(html).toContain(">Science option</h3>");
    expect(html).toContain("Pick 1");
    expect(html).toContain("Pick 2");
    expect(html).toContain(">Biology</h3>");
    expect(html).toContain("Credit hours 3.75");
    expect(html).toContain("Theory: 75");
    expect(html).toContain("Practical: 25.5");
    expect(count(html, />Switched off</g)).toBeGreaterThanOrEqual(3); // the old group, English, and the Practical component
    expect(html).toContain("Science option"); // the group of Biology
  });

  it("a reader who cannot change things sees no forms, no switches and no group pickers", () => {
    const html = view(false);
    expect(count(html, /<form/g)).toBe(0);
    expect(count(html, /<button/g)).toBe(0);
    expect(count(html, /<select/g)).toBe(0);
  });

  it("someone who can change things gets a switch on each group, subject and component, and a group picker on each subject", () => {
    const html = view(true);
    expect(html).toContain('aria-label="Switch off Science option"');
    expect(html).toContain('aria-label="Switch on Old option"');
    expect(html).toContain('aria-label="Switch off Biology"');
    expect(html).toContain('aria-label="Switch on English"');
    expect(html).toContain('aria-label="Switch off Theory"');
    expect(html).toContain('aria-label="Switch on Practical"');
    expect(html).toContain("Elective group for Biology");
    expect(html).toContain("None: everyone takes it");
    expect(count(html, /<form/g)).toBeGreaterThanOrEqual(2); // a component form on each subject
  });

  it("says so when a level has no groups and no subjects", () => {
    const html = view(false, { ...curriculum, groups: [], offerings: [] });
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

    const mark = inContext(<ComponentForm offeringId="o1" name="Biology" onAdded={noop} />);
    expect(mark).toContain(">Component<");
    expect(mark).toContain(">Maximum marks<");
    expect(mark).toContain('inputMode="decimal"');
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
