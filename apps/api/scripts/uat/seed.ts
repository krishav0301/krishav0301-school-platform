import { bsToAd, daysInMonth, todayBs } from "../../src/core/dates";

/**
 * The UAT starter set (D-086): a +2 programme's two levels set up for a year, so testers can start on attendance,
 * classwork, fees and marks at once. Everything goes through the real API, as the screens do (CLAUDE.md section 2:
 * demo and test data is loaded through the same service functions the screens use, never direct SQL), so every
 * rule, permission and audit entry applies.
 *
 * Made: the active year (or this BS year, made and activated), its exam pattern (D-117: graded, three terminals of
 * 30, 30 and 40, the practical in the second and last), class "A" of each level, five subjects (Physics and
 * Chemistry with a 75/25 practical) with credit hours, three teachers hired and assigned (a Class Teacher
 * for each class), six walk-in students per class, and a fee structure per level (approved by the Admin, charged).
 *
 * `OPEN:` the subjects, marks split, grade ranges, credit hours and fee amounts are stand-ins until the college gives
 * its own. The grade ranges are the widely republished NEB scale, unverified (D-079): a stand-in, not the real one.
 * No file system or network here: `call` is the caller's way to reach the API, so the same code runs against a
 * deployment (the command in `../uat-seed.ts`) and inside the tests (`test/uat-seed.test.ts`).
 */

export type Actor = "admin" | "coordinator" | "accountant";
export type Call = (method: "GET" | "POST" | "PUT" | "PATCH", path: string, actor: Actor, body?: unknown) => Promise<Response>;

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

/** A stand-in pattern for the starter set (D-117). OPEN: the school sets its own. */
const PATTERN = {
  graded: true,
  theoryMinPercent: 35,
  practicalMinPercent: 40,
  gradeBands: [
    { grade: "A+", from: 90 },
    { grade: "A", from: 80 },
    { grade: "B+", from: 70 },
    { grade: "B", from: 60 },
    { grade: "C+", from: 50 },
    { grade: "C", from: 40 },
    { grade: "D", from: 35 },
  ],
  terminals: [
    { name: "First terminal", weight: 30, hasPractical: false },
    { name: "Second terminal", weight: 30, hasPractical: true },
    { name: "Final", weight: 40, hasPractical: true },
  ],
};
const WITH_PRACTICAL = new Set(["Physics", "Chemistry"]);

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
  const patch = <T>(path: string, actor: Actor, body?: unknown) => expectOk<T>(call("PATCH", path, actor, body), `PATCH ${path}`);
  const put = <T>(path: string, actor: Actor, body?: unknown) => expectOk<T>(call("PUT", path, actor, body), `PUT ${path}`);

  // The +2 programme: the first in the +2 section with two levels, else the first with two levels.
  const { programmes } = await get<{ programmes: { id: string; name: string; section: { key: string }; levels: { id: string; name: string; active: boolean }[] }[] }>(
    "/api/academics/programmes",
    "coordinator",
  );
  const programme = programmes.find((p) => p.section.key === "plus2" && p.levels.length >= 2) ?? programmes.find((p) => p.levels.length >= 2);
  if (!programme) throw new SeedError("No programme with two levels yet. A school starts with none (D-087): the Admin makes the programmes on the Programmes screen first.");
  const levels = programme.levels.filter((l) => l.active).slice(0, 2);

  // The term (D-110): the open term that already runs these levels (a level is in only one open term); else this BS
  // year's, made by the Principal with them. Its levels are added if missing, and it is opened if still a draft.
  type Year = { id: string; bsYear: number; label: string; status: string; levels: { id: string }[] };
  const levelIds = levels.map((l) => l.id);
  const { years } = await get<{ years: Year[] }>("/api/academics/years", "admin");
  const b = todayBs().year;
  let year = years.find((y) => y.status !== "closed" && y.levels.some((l) => levelIds.includes(l.id))) ?? years.find((y) => y.status === "draft" && y.bsYear === b); // as staging had: a draft of this BS year
  if (!year) {
    const id = (await post<{ id: string }>("/api/academics/years", "admin", { startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }), levelIds })).id;
    year = (await get<{ years: Year[] }>("/api/academics/years", "admin")).years.find((y) => y.id === id)!;
  }
  const missing = levelIds.filter((id) => !year!.levels.some((l) => l.id === id));
  if (missing.length > 0) await patch(`/api/academics/years/${year.id}`, "admin", { levelIds: [...year.levels.map((l) => l.id), ...missing] });
  if (year.status === "draft") await post(`/api/academics/years/${year.id}/activate`, "admin");

  // Refuse to add a second set on top of a year that already has classes: this is a starter set, not a top-up.
  const { classes: existing } = await get<{ classes: { yearId: string }[] }>("/api/academics/classes", "coordinator");
  if (existing.some((c) => c.yearId === year.id)) throw new SeedError(`The ${year.label} year already has classes, so the starter set was not added.`);

  // The term's exam pattern, unless it already has one (D-117).
  const current = await get<{ pattern: unknown; locked: boolean }>(`/api/academics/years/${year.id}/exam-pattern`, "coordinator");
  if (current.pattern === null && !current.locked) await put(`/api/academics/years/${year.id}/exam-pattern`, "coordinator", PATTERN);

  // Subjects: reuse a catalogue entry of the same name in the programme's wing, if one exists (a subject belongs to one wing, D-114).
  const wing = programme.section.key;
  const { subjects: catalogue } = await get<{ subjects: { id: string; name: string; archived: boolean; sectionKey: string | null }[] }>("/api/academics/subjects", "coordinator");
  const subjectIds: Record<string, string> = {};
  for (const s of SUBJECTS) {
    subjectIds[s.name] =
      catalogue.find((c) => c.name === s.name && !c.archived && c.sectionKey === wing)?.id ?? (await post<{ id: string }>("/api/academics/subjects", "coordinator", { name: s.name, sectionKey: wing })).id;
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
      const offeringId = (
        await post<{ id: string }>("/api/academics/offerings", "coordinator", {
          levelId: level.id,
          subjectId: subjectIds[s.name],
          creditHundredths: s.credit * 100,
          fullMarksHundredths: 10_000,
          practicalHundredths: WITH_PRACTICAL.has(s.name) ? 2_500 : null,
        })
      ).id;
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
