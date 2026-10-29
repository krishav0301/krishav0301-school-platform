import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { auditActions, auditKey, call, db, person, programmesAdmin, seedSections, type Person } from "./academics-helpers";

/**
 * Roll numbers (the PM, 2026-10-29). The Co-ordinator, once the students are in, gives the class its roll numbers in one click,
 * alphabetically by name; a number given is never changed or reused; a student who joins a numbered class gets the next number
 * at the end, whatever their name; nobody but a Co-ordinator whose wing reaches the class can give them.
 */

let coordinator: Person, bachelorsCoordinator: Person, admin: Person, teacher: Person, student: Person;
let classId: string, levelId: string;

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
  await seedSections();
  coordinator = await person("coordinator", "institution");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  const bs = 2061;
  const principal = await programmesAdmin();
  const year = await call("/api/academics/years", { method: "POST", cookie: principal.cookie, body: { bsYear: bs, startDate: bsToAd({ year: bs, month: 1, day: 1 }), endDate: bsToAd({ year: bs, month: 12, day: daysInMonth(bs, 12) }) } });
  const yearId = ((await year.json()) as { id: string }).id;
  expect((await call(`/api/academics/years/${yearId}/activate`, { method: "POST", cookie: principal.cookie })).status).toBe(200);
  const programme = await call("/api/academics/programmes", { method: "POST", cookie: principal.cookie, body: { name: "Science", sectionKey: "plus2", affiliation: "NEB" } });
  const programmeId = ((await programme.json()) as { id: string }).id;
  const level = await call(`/api/academics/programmes/${programmeId}/levels`, { method: "POST", cookie: principal.cookie, body: { name: "Grade 11", usualMonths: 12 } });
  levelId = ((await level.json()) as { id: string }).id;
  expect((await call(`/api/academics/years/${yearId}`, { method: "PATCH", cookie: principal.cookie, body: { levelIds: [levelId] } })).status).toBe(200);
  const cls = await call("/api/academics/classes", { method: "POST", cookie: coordinator.cookie, body: { yearId, levelId, label: "Morning" } });
  classId = ((await cls.json()) as { id: string }).id;
});

let n = 0;
/** A walk-in admitted into the class by the Co-ordinator, with no roll number typed. */
async function walkIn(firstName: string, lastName: string): Promise<void> {
  const body = { firstName, lastName, dob: "2008-05-14", phone: `98${String(20000000 + ++n).padStart(8, "0")}`, email: `roll${n}@example.com`, guardianName: "Guardian", guardianPhone: "9800000001", levelId, classId };
  const response = await call("/api/admissions/walk-ins", { method: "POST", body, cookie: coordinator.cookie });
  if (response.status !== 201) throw new Error(`walk-in ${response.status} ${await response.text()}`);
}

/** An application that came through the public form, verified, and approved by the Co-ordinator with a roll number typed in. */
async function admitWithRoll(firstName: string, lastName: string, rollNo: number): Promise<void> {
  const body = { firstName, lastName, dob: "2008-05-14", phone: `98${String(20000000 + ++n).padStart(8, "0")}`, email: `roll${n}@example.com`, guardianName: "Guardian", guardianPhone: "9800000001", levelId, submissionToken: `tok-roll-${n}-${crypto.randomUUID().slice(0, 12)}` };
  const applied = await call("/api/admissions/apply", { method: "POST", body, headers: { "CF-Connecting-IP": `203.0.113.${(n % 250) + 1}` } });
  expect(applied.status).toBe(201);
  const { id } = (await applied.json()) as { id: string };
  const mail = await db.prepare("SELECT body FROM dev_mailbox ORDER BY id DESC LIMIT 1").first<{ body: string }>();
  const token = /#token=([A-Za-z0-9_-]+)/.exec(mail!.body)![1]!;
  expect((await call("/api/admissions/verify", { method: "POST", body: { token } })).status).toBe(200);
  expect((await call(`/api/admissions/applications/${id}/approve`, { method: "POST", body: { classId, rollNo }, cookie: coordinator.cookie })).status).toBe(200);
}

interface Hub {
  rollsToGive: number;
  students: { name: string; rollNo: number | null }[];
}
const hub = async (): Promise<Hub> => (await (await call(`/api/classes/${classId}`, { cookie: coordinator.cookie })).json()) as Hub;
const give = (who: Person) => call(`/api/classes/${classId}/roll-numbers`, { method: "POST", cookie: who.cookie });
const rolls = async () => (await hub()).students.filter((s) => s.rollNo !== null).map((s) => `${s.rollNo} ${s.name}`);

describe("giving a class its roll numbers", () => {
  it("leaves a class with no numbers while students are still being put in, and says how many are waiting", async () => {
    await walkIn("Zoya", "Khan");
    await walkIn("Bimal", "Rai");
    await walkIn("aadarsh", "Yadav");
    await walkIn("Aadarsh", "Mandal");
    const before = await hub();
    expect(before.rollsToGive).toBe(4);
    expect(before.students.every((s) => s.rollNo === null)).toBe(true);
  });

  it("gives them alphabetical numbers from 1: by first name, whatever the letter case, then by last name", async () => {
    const response = await give(coordinator);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ numbered: 4 });
    expect(await rolls()).toEqual(["1 Aadarsh Mandal", "2 aadarsh Yadav", "3 Bimal Rai", "4 Zoya Khan"]);
    expect((await hub()).rollsToGive).toBe(0);
  });

  it("does nothing a second time, and says so: numbers given are never changed", async () => {
    const response = await give(coordinator);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "nothing_to_give" });
    expect(await rolls()).toEqual(["1 Aadarsh Mandal", "2 aadarsh Yadav", "3 Bimal Rai", "4 Zoya Khan"]);
  });

  it("gives a student who joins later the next number at the end, whatever their name", async () => {
    await walkIn("Aaron", "Adams");
    expect(await rolls()).toEqual(["1 Aadarsh Mandal", "2 aadarsh Yadav", "3 Bimal Rai", "4 Zoya Khan", "5 Aaron Adams"]);
    expect((await hub()).rollsToGive).toBe(0);
  });

  it("keeps a roll number typed in at admission, and never gives a number twice, even one a student who left held", async () => {
    await db.prepare("UPDATE enrollments SET status = 'left' WHERE roll_no = 5 AND class_id = (SELECT id FROM classes WHERE public_id = ?1)").bind(classId).run();
    await walkIn("Chandra", "Das");
    await admitWithRoll("Dipesh", "Giri", 20);
    await walkIn("Esha", "Jha");
    const numbers = (await hub()).students.map((s) => s.rollNo);
    expect(numbers).toContain(6); // one past the highest ever given (the one who left held 5), not 5 again
    expect(numbers).toContain(20);
    expect(numbers).toContain(21);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("numbers students who arrive without one (a class that was not numbered at the time), after the highest", async () => {
    await db.prepare("UPDATE enrollments SET roll_no = NULL WHERE roll_no IN (6, 21) AND class_id = (SELECT id FROM classes WHERE public_id = ?1)").bind(classId).run();
    expect((await hub()).rollsToGive).toBe(2);
    expect(await (await give(coordinator)).json()).toEqual({ numbered: 2 });
    const numbers = (await hub()).students.map((s) => s.rollNo);
    expect(numbers.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 20, 21, 22]); // one past the highest left (20), in alphabetical order of the two
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("is audited once per click that did something, and the audit chain still verifies", async () => {
    const actions = await auditActions(classId);
    expect(actions.filter((a) => a === "academics.roll_numbers.given")).toHaveLength(2);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});

describe("who may give roll numbers", () => {
  it("only a Co-ordinator whose wing reaches the class: a teacher, a student and the Admin are refused, another wing's Co-ordinator finds no such class", async () => {
    await db.prepare("UPDATE enrollments SET roll_no = NULL WHERE roll_no = 22 AND class_id = (SELECT id FROM classes WHERE public_id = ?1)").bind(classId).run();
    expect((await give(teacher)).status).toBe(403);
    expect((await give(student)).status).toBe(403);
    expect((await give(admin)).status).toBe(403);
    expect((await call(`/api/classes/${classId}/roll-numbers`, { method: "POST" })).status).toBe(401);
    expect((await give(bachelorsCoordinator)).status).toBe(404);
    expect((await hub()).rollsToGive).toBe(1); // nothing moved
    expect((await give(coordinator)).status).toBe(200);
  });

  it("a class that does not exist is not found", async () => {
    expect((await call(`/api/classes/${"0".repeat(32)}/roll-numbers`, { method: "POST", cookie: coordinator.cookie })).status).toBe(404);
  });
});
