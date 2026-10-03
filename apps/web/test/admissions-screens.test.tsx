import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AdmissionsTabs } from "@/admissions/AdmissionsLayout";
import { ApplicantFields } from "@/admissions/ApplicantFields";
import { ApplyScreen } from "@/admissions/ApplyScreen";
import { QueueRow } from "@/admissions/QueueScreen";
import { RegisterScreen } from "@/admissions/RegisterScreen";
import { SearchScreen } from "@/admissions/SearchScreen";
import { StudentRecordCard } from "@/admissions/StudentRecordCard";
import { StudentsTable } from "@/admissions/SearchScreen";
import { StudentDetails } from "@/admissions/StudentScreen";
import AdmissionsPage from "@/app/portal/admissions/page";
import RegisterPage from "@/app/portal/admissions/register/page";
import OwnAttendancePage from "@/app/portal/attendance/mine/page";
import ReviewSheetPage from "@/app/portal/results/review/page";
import { RoleGate } from "@/shell/RoleGate";
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

const levels: OpenLevel[] = [{ id: "l1", name: "Grade 11", programmeName: "Science", sectionKey: "plus2", sectionName: "+2" }];
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
describe("ApplicantFields", () => {
  it("shows every field with its label, and the level choices", () => {
    const html = inContext(<ApplicantFields values={emptyApplicantForm()} errors={{}} levels={levels} onChange={noop} />);
    for (const label of ["First name", "Last name", "Date of birth", "Phone", "Email", "Guardian&#x27;s name", "Guardian&#x27;s phone", "Applying for"]) expect(html).toContain(label);
    expect(html).toContain("+2 · Science · Grade 11");
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
describe("QueueRow", () => {
  const application = (over: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
    id: "a1",
    firstName: "Sita",
    lastName: "Sharma",
    status: "pending_review",
    walkIn: false,
    levelId: "l1",
    levelName: "Grade 11",
    programmeName: "Science",
    sectionKey: "plus2",
    duplicateFlags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("shows the applicant's name, status and section", () => {
    const html = inContext(<QueueRow application={application()} open={false} onToggle={noop} onDecided={noop} />);
    expect(html).toContain(">Sita Sharma</h2>");
    expect(html).toContain("Pending review");
    expect(html).toContain("Review");
  });

  it("flags a possible duplicate", () => {
    const html = inContext(<QueueRow application={application({ duplicateFlags: ["phone"] })} open={false} onToggle={noop} onDecided={noop} />);
    expect(html).toContain("Possible duplicate");
  });

  it("marks needs_changes distinctly from pending_review", () => {
    const html = inContext(<QueueRow application={application({ status: "needs_changes" })} open={false} onToggle={noop} onDecided={noop} />);
    expect(html).toContain("Needs your attention");
    expect(html).toContain('class="badge bad"');
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
describe("SearchScreen", () => {
  it("shows the search field, with no results section until something is typed", () => {
    const html = inContext(<SearchScreen />);
    expect(html).toContain("Student search");
    expect(html).toContain("Name, SID or phone");
    expect(html).not.toContain("No matches.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("StudentRecordCard", () => {
  it("shows the shape of the card while it loads", () => {
    const html = inContext(<StudentRecordCard />, as("student", "own"));
    expect(html).toContain("Your record");
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
  });
});

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
    expect(accountantHtml).toContain("Search");
  });

  it("offers the Principal no Register form: Search is their only reach, and a menu of one is not shown (admin FUT F-08)", () => {
    expect(inContext(<AdmissionsTabs pathname="/portal/admissions/search" />, as("admin"))).toBe("");
    const html = inContext(<AdmissionsPage />, as("admin"));
    expect(html).toContain("Student search");
    expect(html).not.toContain("Register a student");
  });
});

describe("pages of other roles, opened by address (admin FUT F-14)", () => {
  it("say the same thing: no access, rather than an empty screen or a form", () => {
    for (const page of [<RegisterPage key="r" />, <OwnAttendancePage key="a" />, <ReviewSheetPage key="v" />]) expect(inContext(page, as("admin"))).toContain("You do not have access to this page.");
    expect(inContext(<RoleGate roles={["teacher"]}>shown</RoleGate>, as("teacher"))).toBe("shown");
  });
});

describe("a student's record from Student search (admin FUT F-09)", () => {
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
    const found = inContext(<StudentsTable students={[{ id: "s1", sid: "2083-00012", firstName: "Rishav", lastName: "Kumar", status: "graduated", className: null }]} />, as("admin"));
    expect(found).toContain('href="/portal/admissions/student?id=s1"');
    expect(found).toContain(">Graduated<");
  });
});
