import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AdmissionsTabs } from "@/admissions/AdmissionsLayout";
import { ApplicantFields } from "@/admissions/ApplicantFields";
import { ApplyScreen } from "@/admissions/ApplyScreen";
import { QueueCard, queueFigures } from "@/admissions/QueueScreen";
import { levelsFor } from "@/admissions/RegisterScreen";
import { changesOf } from "@/admissions/CorrectDetails";
import { RegisterScreen } from "@/admissions/RegisterScreen";
import { StudentsScreen, StudentsTable } from "@/admissions/StudentsScreen";
import { StudentDetails } from "@/admissions/StudentScreen";
import AdmissionsPage from "@/app/portal/admissions/page";
import RegisterPage from "@/app/portal/admissions/register/page";
import OwnAttendancePage from "@/app/portal/attendance/mine/page";
import ReviewSheetPage from "@/app/portal/results/review/page";
import { RoleGate } from "@/shell/RoleGate";
import { choiceForLevel, levelSteps } from "@/admissions/level-steps";
import { emptyApplicantForm, validateApplicant, type ApplicationSummary, type OpenLevel } from "@/admissions/model";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/admissions", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section" | "own" = "institution") => fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role, scope }] } });
const inContext = (element: React.ReactNode, session = as("coordinator")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const levels: OpenLevel[] = [{ id: "l1", name: "Grade 11", programmeId: "p1", programmeName: "Science", sectionKey: "plus2", sectionName: "+2" }];
const open = (id: string, name: string, programmeId: string, programmeName: string, sectionKey: string, sectionName: string): OpenLevel => ({ id, name, programmeId, programmeName, sectionKey, sectionName });
const many: OpenLevel[] = [
  open("g11", "Grade 11", "sci", "Science", "plus2", "+2"),
  open("g12", "Grade 12", "sci", "Science", "plus2", "+2"),
  open("m11", "Grade 11", "mgmt", "Management", "plus2", "+2"),
  open("y1", "Year 1", "bbs", "BBS", "bachelors", "Bachelor's"),
];
const noop = () => {};

// ---------------------------------------------------------------------------------------------
describe("validateApplicant", () => {
  it("flags every required field on an empty form", () => {
    const errors = validateApplicant(emptyApplicantForm());
    expect(Object.keys(errors).sort()).toEqual(["dobBs", "email", "firstName", "guardianName", "guardianPhone", "lastName", "levelId", "phone"]);
  });

  it("is satisfied by a complete, well-formed form", () => {
    const errors = validateApplicant({
      ...emptyApplicantForm(),
      firstName: "Sita",
      lastName: "Sharma",
      dobBs: "2065-01-01",
      phone: "9800000000",
      email: "sita@example.com",
      guardianName: "Ram Sharma",
      guardianPhone: "9800000001",
      levelId: "l1",
    });
    expect(errors).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
describe("Applying for: wing, course, level (D-114)", () => {
  it("offers each step's choices and settles a step with one entry", () => {
    const start = levelSteps(many, { sectionKey: null, programmeId: null, levelId: null });
    expect(start.wings.map((w) => w.key)).toEqual(["plus2", "bachelors"]);
    expect(start.courses).toEqual([]);
    const bachelors = levelSteps(many, { sectionKey: "bachelors", programmeId: null, levelId: null });
    expect(bachelors.choice).toEqual({ sectionKey: "bachelors", programmeId: "bbs", levelId: "y1" });
    const plus2 = levelSteps(many, { sectionKey: "plus2", programmeId: "sci", levelId: null });
    expect(plus2.levels.map((l) => l.id)).toEqual(["g11", "g12"]);
    expect(levelSteps(many, { sectionKey: "plus2", programmeId: "bbs", levelId: "y1" }).choice).toEqual({ sectionKey: "plus2", programmeId: null, levelId: null });
  });

  it("finds a level's wing and course", () => {
    expect(choiceForLevel(many, "m11")).toEqual({ sectionKey: "plus2", programmeId: "mgmt", levelId: "m11" });
  });
});

describe("ApplicantFields", () => {
  it("shows every field with its label; with one open level, it says where the applicant is applying", () => {
    const html = inContext(<ApplicantFields values={emptyApplicantForm()} errors={{}} levels={levels} onChange={noop} />);
    for (const label of ["First name", "Last name", "Date of birth", "Phone", "Email", "Guardian&#x27;s name", "Guardian&#x27;s phone", "Applying for"]) expect(html).toContain(label);
    for (const line of [": +2<", ": Science<", ": Grade 11<"]) expect(html).toContain(line);
  });

  it("asks for the wing first, then the course, then the level (D-114)", () => {
    const html = inContext(<ApplicantFields values={emptyApplicantForm()} errors={{}} levels={many} onChange={noop} />);
    expect(html).toContain(">Bachelor&#x27;s<");
    expect(html).not.toContain(">Management<"); // the course comes after the wing
    const chosen = inContext(<ApplicantFields values={{ ...emptyApplicantForm(), levelId: "g12" }} errors={{}} levels={many} onChange={noop} />);
    expect(chosen).toContain(">Management<");
    expect(chosen).toMatch(/<option value="g12" selected="">Grade 12<\/option>/);
  });

  it("shows an error under the field it belongs to", () => {
    const html = inContext(<ApplicantFields values={emptyApplicantForm()} errors={{ firstName: "admissions.error.required" }} levels={levels} onChange={noop} />);
    expect(html).toContain("This is required.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the public apply screen and its own record", () => {
  it("shows the shape of the page while the levels load", () => {
    const html = inContext(<ApplyScreen />, fakeSession({ status: "signedOut", me: null }));
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the queue (D-106; Co-ordinator FUT F-05)", () => {
  const application = (over: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
    id: "a1",
    firstName: "Sita",
    lastName: "Sharma",
    status: "pending_review",
    walkIn: false,
    levelId: "l1",
    levelName: "Grade 11",
    programmeName: "Science",
    sectionKey: "s1a8b79d074",
    sectionName: "+2",
    duplicateFlags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  const now = new Date("2026-01-04T00:00:00.000Z");

  it("names the applicant, the section by its name (never its key), the level, how long ago, and the state in words", () => {
    const html = inContext(<QueueCard application={application()} now={now} onReview={noop} />);
    expect(html).toContain(">Sita Sharma</h3>");
    expect(html).toContain("+2 · Science · Grade 11");
    expect(html).not.toContain("s1a8b79d074");
    expect(html).toContain("applied 3 days ago");
    expect(html).toContain("Pending review");
    expect(html).toContain(">Review<");
  });

  it("flags a possible duplicate, and marks Asked for changes in words", () => {
    expect(inContext(<QueueCard application={application({ duplicateFlags: ["phone"] })} now={now} onReview={noop} />)).toContain(">Possible duplicate<");
    expect(inContext(<QueueCard application={application({ status: "needs_changes" })} now={now} onReview={noop} />)).toContain("Needs your attention");
  });

  it("counts waiting, asked for changes and possible duplicates", () => {
    const figures = queueFigures([application(), application({ id: "a2", status: "needs_changes" }), application({ id: "a3", duplicateFlags: ["name_dob"] })]);
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ["Waiting for review", "2"],
      ["Asked for changes", "1"],
      ["Possible duplicates", "1"],
    ]);
  });
});

describe("the walk-in form (Co-ordinator FUT F-11)", () => {
  const level = (id: string, sectionKey: string) => ({ id, name: "Year 1", programmeId: "p", programmeName: "P", sectionKey, sectionName: sectionKey });
  const levels = [level("l1", "plus2"), level("l2", "bachelors")];
  it("a Co-ordinator of one section is offered only that section's levels; a whole-school one all of them", () => {
    expect(levelsFor(levels, [{ role: "coordinator", scope: "section", section: "bachelors" }]).map((l) => l.id)).toEqual(["l2"]);
    expect(levelsFor(levels, [{ role: "coordinator", scope: "institution" }]).map((l) => l.id)).toEqual(["l1", "l2"]);
  });
});

describe("correcting details (Co-ordinator FUT F-06)", () => {
  const base = { firstName: "Ram", middleName: "", lastName: "Sah", dobBs: "2065-01-19", phone: "", guardianName: "Hari", guardianPhone: "9800000000", previousSchool: "" };
  it("sends only what changed; an emptied optional detail is sent as removed", () => {
    expect(changesOf(base, { ...base, lastName: "Shah ", phone: "9811111111" })).toEqual({ lastName: "Shah", phone: "9811111111" });
    expect(changesOf({ ...base, previousSchool: "Old" }, base)).toEqual({ previousSchool: null });
    expect(changesOf(base, base)).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
describe("RegisterScreen", () => {
  it("shows its title at once, before the level list has loaded, and a walk-in placeholder", () => {
    const html = inContext(<RegisterScreen canPlace />);
    expect(html).toContain(">Register a walk-in</h1>");
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });

  it("titles itself for a queued registration when the Accountant cannot place the student", () => {
    const html = inContext(<RegisterScreen canPlace={false} />, as("accountant"));
    expect(html).toContain(">Register a student</h1>");
    expect(html).toContain("Co-ordinator&#x27;s review queue");
  });
});

// ---------------------------------------------------------------------------------------------
describe("StudentsScreen", () => {
  it("opens on the list itself: the counts, a search and the filters, and the list's shape while it loads", () => {
    const html = inContext(<StudentsScreen />);
    expect(html).toContain(">Students</h1>");
    expect(html).toContain("Search by name, SID or phone");
    expect(html).toContain("Active students");
    expect(html).toContain('aria-busy="true"');
  });
});

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
describe("AdmissionsTabs", () => {
  it("gives the Co-ordinator a Queue tab, marked current, that the Accountant does not see", () => {
    const coordinatorHtml = inContext(<AdmissionsTabs pathname="/portal/admissions" />, as("coordinator"));
    expect(coordinatorHtml).toContain("Queue");
    expect(coordinatorHtml).toMatch(/aria-current="page"[^>]*>Queue</);
    expect(coordinatorHtml).toContain("Walk-in");

    const accountantHtml = inContext(<AdmissionsTabs pathname="/portal/admissions/register" />, as("accountant"));
    expect(accountantHtml).not.toContain("Queue");
    expect(accountantHtml).toContain("Register");
    expect(accountantHtml).toContain("Students");
  });

  it("offers the Principal no Register form: Students is their only reach, and a menu of one is not shown (admin FUT F-08)", () => {
    expect(inContext(<AdmissionsTabs pathname="/portal/admissions/search" />, as("admin"))).toBe("");
    const html = inContext(<AdmissionsPage />, as("admin"));
    expect(html).toContain(">Students</h1>");
    expect(html).not.toContain("Register a student");
  });
});

describe("pages of other roles, opened by address (admin FUT F-14)", () => {
  it("say the same thing: no access, rather than an empty screen or a form", () => {
    for (const page of [<RegisterPage key="r" />, <OwnAttendancePage key="a" />, <ReviewSheetPage key="v" />]) expect(inContext(page, as("admin"))).toContain("You do not have access to this page.");
    expect(inContext(<RoleGate roles={["teacher"]}>shown</RoleGate>, as("teacher"))).toBe("shown");
  });
});

describe("a student's record from the Students page (admin FUT F-09)", () => {
  it("search results open the record, which shows the personal details read only", () => {
    const html = inContext(
      <StudentDetails
        student={{ id: "s1", sid: "2083-00012", firstName: "Rishav", middleName: null, lastName: "Kumar", dob: "2008-05-01", dobBs: "2065-01-19", phone: "9800000000", email: null, guardianName: "Ram Kumar", guardianPhone: "9811111111", previousSchool: null, status: "active", className: "BBS · Year 1", createdAt: "2026-09-01T00:00:00Z" }}
      />,
      as("admin"),
    );
    expect(html).toContain(">Rishav Kumar</h1>");
    expect(html).toContain("2083-00012");
    expect(html).toContain("19 Baisakh 2065");
    expect(html).toContain("Ram Kumar");
    expect(html).not.toMatch(/<input|<button/);
  });

  it("says Active, Left or Graduated in words, and offers the fee account only where asked (D-104)", () => {
    const student = { id: "s1", sid: "2083-00012", firstName: "Rishav", middleName: null, lastName: "Kumar", dob: "2008-05-01", dobBs: "2065-01-19", phone: null, email: null, guardianName: "Ram Kumar", guardianPhone: "9811111111", previousSchool: null, status: "left" as const, className: "BBS · Year 1", createdAt: "2026-09-01T00:00:00Z" };
    const html = inContext(<StudentDetails student={student} feesLink />, as("admin"));
    expect(html).toContain(">Left<");
    expect(html).toContain('href="/portal/fees/student?id=s1"');
    expect(inContext(<StudentDetails student={student} />, as("coordinator"))).not.toContain("/portal/fees/");
    const found = inContext(<StudentsTable students={[{ id: "s1", sid: "2083-00012", firstName: "Rishav", lastName: "Kumar", status: "graduated", guardianPhone: "9811111111", rollNo: null, class: null, term: null }]} />, as("admin"));
    expect(found).toContain('href="/portal/admissions/student?id=s1"');
    expect(found).toContain(">Graduated<");
  });
});
