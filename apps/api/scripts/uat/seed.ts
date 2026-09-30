import { bsToAd, daysInMonth, todayBs } from "../../src/core/dates";

/**
 * The UAT starter set (D-086): a +2 programme's two levels set up for a year, so testers can start on attendance,
 * classwork, fees and marks at once. Everything goes through the real API, as the screens do (CLAUDE.md section 2:
 * demo and test data is loaded through the same service functions the screens use, never direct SQL), so every
 * rule, permission and audit entry applies.
 *
 * Made: the active year (or this BS year, made and activated), three terminals, class "A" of each level, five
 * subjects with theory and practical parts and credit hours, three teachers hired and assigned (a Class Teacher
 * for each class), six walk-in students per class, and a fee structure per level (approved by the Admin, charged).
 *
 * `OPEN:` the subjects, marks split, credit hours and fee amounts are stand-ins until the college gives its own.
 * No file system or network here: `call` is the caller's way to reach the API, so the same code runs against a
 * deployment (the command in `../uat-seed.ts`) and inside the tests (`test/uat-seed.test.ts`).
 */

export type Actor = "admin" | "coordinator" | "accountant";
export type Call = (method: "GET" | "POST" | "PUT", path: string, actor: Actor, body?: unknown) => Promise<Response>;

export interface NewAccount {
  role: "teacher" | "student";
  name: string;
  email: string;
  temporaryPassword: string;
  sid?: string;
  className?: string;
}

export interface SeedResult {
  yearLabel: string;
  classes: { id: string; name: string }[];
  accounts: NewAccount[];
}

const SUBJECTS: { name: string; credit: number }[] = [
  { name: "English", credit: 4 },
  { name: "Nepali", credit: 3 },
  { name: "Mathematics", credit: 5 },
  { name: "Physics", credit: 5 },
  { name: "Chemistry", credit: 5 },
];

const TEACHERS = ["Sarita Karki", "Bikash Yadav", "Anjali Shah"];
/** Which teacher (by index) takes which subject, in every class. */
const TEACHES: Record<string, number> = { English: 0, Nepali: 0, Mathematics: 1, Physics: 1, Chemistry: 2 };

const STUDENTS = [
  ["Aarav", "Mandal"],
  ["Sita", "Chaudhary"],
  ["Rohan", "Sah"],
  ["Puja", "Yadav"],
  ["Nabin", "Thakur"],
  ["Kritika", "Jha"],
  ["Suman", "Rai"],
  ["Anita", "Das"],
  ["Deepak", "Gupta"],
  ["Rekha", "Mahato"],
  ["Prakash", "Karn"],
  ["Sabina", "Tamang"],
] as const;

const FEES = [
  { name: "Tuition", amountPaisa: 250_000, frequency: "monthly" },
  { name: "Examination", amountPaisa: 300_000, frequency: "yearly" },
  { name: "Admission", amountPaisa: 1_000_000, frequency: "one_time" },
] as const;

export class SeedError extends Error {}

async function expectOk<T>(response: Promise<Response>, what: string, statuses = [200, 201]): Promise<T> {
  const r = await response;
  if (!statuses.includes(r.status)) throw new SeedError(`${what}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export async function seedUat(call: Call, options: { tag: string; emailDomain?: string }): Promise<SeedResult> {
  const domain = options.emailDomain ?? "example.com";
  const email = (who: string) => `uat-${who}-${options.tag}@${domain}`;
  const get = <T>(path: string, actor: Actor) => expectOk<T>(call("GET", path, actor), `GET ${path}`);
  const post = <T>(path: string, actor: Actor, body?: unknown) => expectOk<T>(call("POST", path, actor, body), `POST ${path}`);

  // The +2 programme: the one graded the NEB way, else the first with two levels.
  const { programmes } = await get<{ programmes: { id: string; name: string; section: { key: string }; gradingPolicy: string | null; levels: { id: string; name: string; active: boolean }[] }[] }>(
    "/api/academics/programmes",
    "coordinator",
  );
  const programme = programmes.find((p) => p.gradingPolicy === "neb_gpa" && p.levels.length >= 2) ?? programmes.find((p) => p.levels.length >= 2);
  if (!programme) throw new SeedError("No programme with two levels. Apply the school's pack first.");
  const levels = programme.levels.filter((l) => l.active).slice(0, 2);

  // The year: the active one, or this BS year made and activated.
  const { years } = await get<{ years: { id: string; label: string; status: string }[] }>("/api/academics/years", "coordinator");
  let year = years.find((y) => y.status === "active");
  if (!year) {
    const b = todayBs().year;
    const made = await post<{ id: string }>("/api/academics/years", "coordinator", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) });
    await post(`/api/academics/years/${made.id}/activate`, "coordinator");
    year = (await get<{ years: { id: string; label: string; status: string }[] }>("/api/academics/years", "coordinator")).years.find((y) => y.id === made.id)!;
  }

  // Refuse to add a second set on top of a year that already has classes: this is a starter set, not a top-up.
  const { classes: existing } = await get<{ classes: { yearId: string }[] }>("/api/academics/classes", "coordinator");
  if (existing.some((c) => c.yearId === year.id)) throw new SeedError(`The ${year.label} year already has classes, so the starter set was not added.`);

  for (const name of ["First terminal", "Second terminal", "Final"]) await post("/api/academics/terminals", "coordinator", { yearId: year.id, name });

  // Subjects: reuse a catalogue entry of the same name, if one exists.
  const { subjects: catalogue } = await get<{ subjects: { id: string; name: string; archived: boolean }[] }>("/api/academics/subjects", "coordinator");
  const subjectIds: Record<string, string> = {};
  for (const s of SUBJECTS) {
    subjectIds[s.name] = catalogue.find((c) => c.name === s.name && !c.archived)?.id ?? (await post<{ id: string }>("/api/academics/subjects", "coordinator", { name: s.name })).id;
  }

  const accounts: NewAccount[] = [];
  const teacherIds: string[] = [];
  for (const [i, fullName] of TEACHERS.entries()) {
    const address = email(`teacher${i + 1}`);
    const hired = await post<{ id: string; temporaryPassword: string }>("/api/teachers", "coordinator", { fullName, email: address, homeSectionKey: programme.section.key });
    teacherIds.push(hired.id);
    accounts.push({ role: "teacher", name: fullName, email: address, temporaryPassword: hired.temporaryPassword });
  }

  const classes: SeedResult["classes"] = [];
  let studentNo = 0;
  for (const [li, level] of levels.entries()) {
    const classId = (await post<{ id: string }>("/api/academics/classes", "coordinator", { yearId: year.id, levelId: level.id, label: "A" })).id;
    const className = `${programme.name} · ${level.name} A`;
    classes.push({ id: classId, name: className });

    for (const s of SUBJECTS) {
      const offeringId = (await post<{ id: string }>("/api/academics/offerings", "coordinator", { levelId: level.id, subjectId: subjectIds[s.name], creditHundredths: s.credit * 100 })).id;
      await post(`/api/academics/offerings/${offeringId}/components`, "coordinator", { name: "Theory", maxHundredths: 7_500, kind: "theory" });
      await post(`/api/academics/offerings/${offeringId}/components`, "coordinator", { name: "Practical", maxHundredths: 2_500, kind: "practical" });
      await post("/api/academics/assignments", "coordinator", { classId, offeringId, teacherId: teacherIds[TEACHES[s.name]!] });
    }
    // One class per Class Teacher in a year: the first teacher has Grade 11, the second Grade 12.
    await post(`/api/academics/classes/${classId}/class-teacher`, "coordinator", { teacherId: teacherIds[li] });

    for (let k = 0; k < 6; k++) {
      const [firstName, lastName] = STUDENTS[studentNo % STUDENTS.length]!;
      studentNo++;
      const address = email(`student${studentNo}`);
      const admitted = await post<{ sid: string; temporaryPassword: string }>("/api/admissions/walk-ins", "coordinator", {
        firstName,
        lastName,
        dob: `${2008 - li}-0${1 + (k % 9)}-1${k}`,
        phone: `98${options.tag.replace(/\D/g, "").padEnd(4, "0").slice(0, 4)}${String(studentNo).padStart(4, "0")}`,
        email: address,
        guardianName: `${lastName} guardian`,
        guardianPhone: `97${String(studentNo).padStart(8, "0")}`,
        levelId: level.id,
        classId,
      });
      accounts.push({ role: "student", name: `${firstName} ${lastName}`, email: address, temporaryPassword: admitted.temporaryPassword, sid: admitted.sid, className });
    }

    // Fees for the level: drafted by the Accountant, approved by the Admin, charged to the class.
    const structureId = (await post<{ id: string }>("/api/fees/structures", "accountant", { levelId: level.id })).id;
    for (const item of FEES) await post(`/api/fees/structures/${structureId}/items`, "accountant", item);
    await post(`/api/fees/structures/${structureId}/send`, "accountant", {});
    const { requests } = await get<{ requests: { id: string; subjectId: string }[] }>("/api/approvals", "admin");
    const request = requests.find((r) => r.subjectId === structureId);
    if (!request) throw new SeedError("The fee structure's approval request did not reach the Admin.");
    await post(`/api/approvals/${request.id}/approve`, "admin");
    await post(`/api/fees/structures/${structureId}/charges`, "accountant", { classId });
  }

  return { yearLabel: year.label, classes, accounts };
}
