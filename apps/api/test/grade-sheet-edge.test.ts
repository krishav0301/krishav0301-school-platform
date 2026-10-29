import { beforeAll, describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, runTerminal, sheetIdOf, type Subject, type Term } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * Trying to break the grade-point marks card and the mark ledger through the real routes: who may read what, odd data, ties,
 * absences, a student who left, a recheck, pass marks per subject, ids that do not exist, classes that are not published.
 */
const layout = JSON.stringify(parsePack(lahanJson).school.gradeSheet);
const setSchool = (passMarks: boolean) =>
  db
    .prepare("INSERT INTO school (id, name, short_name, grade_sheet_json, pass_marks_per_subject) VALUES (1, 'Test school', 'Test', ?1, ?2) ON CONFLICT (id) DO UPDATE SET grade_sheet_json = excluded.grade_sheet_json, pass_marks_per_subject = excluded.pass_marks_per_subject")
    .bind(layout, passMarks ? 1 : 0)
    .run();

let coordinator: Person, otherWing: Person, admin: Person, accountant: Person, teacher: Person;
let term: Term, terminalId: string;
let a: ClassFixture, b: ClassFixture, science: Subject;

interface Sheet {
  student: { name: string; dateOfBirthBs: string | null; rollNo: number | null };
  subjects: { theory: { absent: boolean; valueHundredths: number | null; maxHundredths: number } | null; practical: { absent: boolean } | null; theoryGrade: string | null; practicalGrade: string | null; finalGrade: string; pointHundredths: number; highestPointHundredths: number }[];
  rank: number;
  classSize: number;
  division: string | null;
  percentHundredths: number;
  totalObtainedHundredths: number;
}
interface Own {
  results: { kind: "terminal" | "final"; publicationId: string; card: { id: string } }[];
}
const own = async (c: ClassFixture, i: number) => ((await (await call("/api/results/me", { cookie: c.pupils[i]!.person.cookie })).json()) as Own).results;
const cardOf = async (c: ClassFixture, i: number, kind: "terminal" | "final" = "terminal") => (await own(c, i)).find((r) => r.kind === kind)!.card.id;
const sheetOf = async (c: ClassFixture, i: number): Promise<Sheet> => (await (await call(`/api/results/grade-sheets/${await cardOf(c, i)}`, { cookie: coordinator.cookie })).json()) as Sheet;
const ledgerPath = (c: ClassFixture) => `/api/results/classes/${c.classId}/terminals/${terminalId}/ledger`;

beforeAll(async () => {
  await seedSections();
  await setSchool(false);
  coordinator = await person("coordinator", "institution");
  otherWing = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  // One terminal that holds the practical; a science paper of 100, 25 of it practical.
  term = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: true }]));
  terminalId = term.terminals[0]!;
  a = await resultsClass("plus2", 5, term);
  b = await resultsClass("plus2", 2, term);
  science = await addSubject(a, { full: 100, practical: 25 });
  const bScience = await addSubject(b, { full: 100, practical: 25 });
  // Pupils 0 and 1 tie on full marks; 2 is absent from both parts; 3 gets 40 per cent; 4 gets 99 per cent.
  const pct = [100, 100, null, 40, 99];
  expect((await runTerminal(a, [science], terminalId, (p) => pct[p] ?? null, coordinator)).status).toBe(201);
  expect((await runTerminal(b, [bScience], terminalId, 70, coordinator)).status).toBe(201);
});

describe("ties, absences and a paper with a practical", () => {
  it("equal totals share a rank and the next follows (dense, as Lahan's ledger), and the absent student is last", async () => {
    const ranks = [] as number[];
    for (let i = 0; i < 5; i++) ranks.push((await sheetOf(a, i)).rank);
    expect(ranks).toEqual([1, 1, 4, 3, 2]);
    expect((await sheetOf(a, 0)).classSize).toBe(5);
  });

  it("ranks only within the class: the other class's students do not count", async () => {
    expect((await sheetOf(b, 0)).classSize).toBe(2);
  });

  it("shows theory and practical on their own, each graded on its own marks", async () => {
    const s = (await sheetOf(a, 3)).subjects[0]!;
    expect(s.theory).toMatchObject({ valueHundredths: 3000, maxHundredths: 7500 });
    expect([s.theoryGrade, s.practicalGrade, s.finalGrade]).toEqual(["D+", "D+", "D+"]); // 40 per cent stays in the band below C, as on the shared cards
    expect((await sheetOf(a, 0)).subjects[0]).toMatchObject({ theoryGrade: "A+", practicalGrade: "A+", finalGrade: "A+", pointHundredths: 400 });
  });

  it("an absent student: absence in both parts, NG and a point of 0, no division, zero marks, and still on the ledger", async () => {
    const s = await sheetOf(a, 2);
    expect(s.subjects[0]).toMatchObject({ theory: { absent: true }, practical: { absent: true }, finalGrade: "NG", pointHundredths: 0 });
    expect([s.division, s.totalObtainedHundredths]).toEqual([null, 0]);
    const ledger = (await (await call(ledgerPath(a), { cookie: coordinator.cookie })).json()) as { students: { marks: ({ absent: boolean } | null)[]; rank: number }[] };
    expect(ledger.students).toHaveLength(5);
    expect(ledger.students.some((l) => l.marks[0]?.absent === true && l.rank === 4)).toBe(true);
  });

  it("the highest grade point is the class's best, shown on every student's own card", async () => {
    for (let i = 0; i < 5; i++) expect((await sheetOf(a, i)).subjects[0]!.highestPointHundredths).toBe(400);
    expect((await sheetOf(b, 0)).subjects[0]!.highestPointHundredths).toBe(280); // class B's best is 70 per cent: a B, since a mark on a band's number stays in the band below
  });
});

describe("who may read what", () => {
  it("a student reads only their own card and never another's, in the class or in another class", async () => {
    const mine = await cardOf(a, 0);
    const theirs = await cardOf(a, 1);
    const otherClass = await cardOf(b, 0);
    expect((await call(`/api/results/grade-sheets/${mine}`, { cookie: a.pupils[0]!.person.cookie })).status).toBe(200);
    expect((await call(`/api/results/grade-sheets/${theirs}`, { cookie: a.pupils[0]!.person.cookie })).status).toBe(404);
    expect((await call(`/api/results/grade-sheets/${otherClass}`, { cookie: a.pupils[0]!.person.cookie })).status).toBe(404);
  });

  it("the Co-ordinator and the Admin read both documents; the Accountant, a subject teacher and the public do not", async () => {
    const card = await cardOf(a, 0);
    for (const who of [coordinator, admin]) {
      expect((await call(`/api/results/grade-sheets/${card}`, { cookie: who.cookie })).status).toBe(200);
      expect((await call(ledgerPath(a), { cookie: who.cookie })).status).toBe(200);
    }
    // The Accountant has neither right. A subject teacher has no right to a marks card, and finds no such class sheet (as for the class sheet itself).
    expect((await call(`/api/results/grade-sheets/${card}`, { cookie: accountant.cookie })).status).toBe(403);
    expect((await call(ledgerPath(a), { cookie: accountant.cookie })).status).toBe(403);
    expect((await call(`/api/results/grade-sheets/${card}`, { cookie: teacher.cookie })).status).toBe(404); // a teacher who does not lead this class
    expect((await call(ledgerPath(a), { cookie: teacher.cookie })).status).toBe(404);
    expect((await call(`/api/results/grade-sheets/${card}`)).status).toBe(401);
    expect((await call(ledgerPath(a))).status).toBe(401);
  });

  it("a Co-ordinator of another wing finds nothing: not the card, not the ledger", async () => {
    expect((await call(`/api/results/grade-sheets/${await cardOf(a, 0)}`, { cookie: otherWing.cookie })).status).toBe(404);
    expect((await call(ledgerPath(a), { cookie: otherWing.cookie })).status).toBe(404);
  });

  it("a Class Teacher reads the ledger and every card of their own class, and nothing of another class", async () => {
    expect((await call(ledgerPath(a), { cookie: a.classTeacher.cookie })).status).toBe(200);
    expect((await call(ledgerPath(b), { cookie: a.classTeacher.cookie })).status).toBe(404);
    for (let i = 0; i < 5; i++) {
      const id = await cardOf(a, i);
      expect((await call(`/api/results/grade-sheets/${id}`, { cookie: a.classTeacher.cookie })).status).toBe(200);
      expect((await call(`/api/results/cards/${id}`, { cookie: a.classTeacher.cookie })).status).toBe(200);
    }
    const other = await cardOf(b, 0);
    expect((await call(`/api/results/grade-sheets/${other}`, { cookie: a.classTeacher.cookie })).status).toBe(404);
    expect((await call(`/api/results/cards/${other}`, { cookie: a.classTeacher.cookie })).status).toBe(404);
    // Another class's teacher opens neither this class's cards nor its ledger.
    expect((await call(`/api/results/grade-sheets/${await cardOf(a, 0)}`, { cookie: b.classTeacher.cookie })).status).toBe(404);
  });

  it("opening cards gives a Class Teacher nothing else: still refused the rechecks, a student's whole results and own results, as before", async () => {
    expect((await call("/api/results/rechecks", { cookie: a.classTeacher.cookie })).status).toBe(403);
    expect((await call(`/api/results/students/${a.pupils[0]!.studentId}`, { cookie: a.classTeacher.cookie })).status).toBe(403);
    expect((await call("/api/results/me", { cookie: a.classTeacher.cookie })).status).toBe(403);
  });

  it("odd ids are refused or not found, never a crash", async () => {
    expect((await call("/api/results/grade-sheets/abc", { cookie: coordinator.cookie })).status).toBe(400);
    expect((await call(`/api/results/grade-sheets/${"0".repeat(32)}`, { cookie: coordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${a.classId}/terminals/${"f".repeat(32)}/ledger`, { cookie: coordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${"0".repeat(32)}/terminals/${terminalId}/ledger`, { cookie: coordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/not-an-id/final/ledger`, { cookie: coordinator.cookie })).status).toBe(400);
    expect((await call(`/api/results/grade-sheets/${"%27 OR 1=1 --"}`, { cookie: coordinator.cookie })).status).toBe(400);
  });
});

describe("odd data", () => {
  it("a date of birth the date module cannot convert prints blank instead of failing the card", async () => {
    await db.prepare("UPDATE students SET dob_ad = '1920-01-01' WHERE public_id = ?1").bind(a.pupils[3]!.studentId).run();
    const response = await call(`/api/results/grade-sheets/${await cardOf(a, 3)}`, { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Sheet).student.dateOfBirthBs).toBeNull();
  });

  it("a student entered with just a name has no date of birth, and their card still prints, with it blank", async () => {
    await db.prepare("UPDATE students SET dob_ad = NULL WHERE public_id = ?1").bind(a.pupils[3]!.studentId).run();
    const response = await call(`/api/results/grade-sheets/${await cardOf(a, 3)}`, { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Sheet).student.dateOfBirthBs).toBeNull();
  });

  it("a student who left stays on the class's ledger and in its rank (they sat the exam)", async () => {
    await db.prepare("UPDATE enrollments SET status = 'left' WHERE public_id = ?1").bind(a.pupils[3]!.enrollmentId).run();
    const ledger = (await (await call(ledgerPath(a), { cookie: coordinator.cookie })).json()) as { students: unknown[] };
    expect(ledger.students).toHaveLength(5);
    await db.prepare("UPDATE enrollments SET status = 'active' WHERE public_id = ?1").bind(a.pupils[3]!.enrollmentId).run();
  });

  it("a name corrected after publishing shows corrected on the card and the ledger (identity is read live; the marks stay as published), and HTML in a name stays plain text", async () => {
    await db.prepare("UPDATE students SET first_name = '<b>Corrected</b>' WHERE public_id = ?1").bind(a.pupils[4]!.studentId).run();
    expect((await sheetOf(a, 4)).student.name).toContain("<b>Corrected</b>");
    const ledger = (await (await call(ledgerPath(a), { cookie: coordinator.cookie })).json()) as { students: { name: string }[] };
    expect(ledger.students.some((s) => s.name.includes("<b>Corrected</b>"))).toBe(true);
  });

  it("a terminal that is not published has no ledger, and neither does a final that is not out", async () => {
    const unpublished = await examTerm(pattern(false, [{ name: "First", weight: 50, hasPractical: false }, { name: "Second", weight: 50, hasPractical: false }]));
    const c = await resultsClass("plus2", 2, unpublished);
    const sub = await addSubject(c, { full: 100 });
    await enterAndSubmit(c, sub, unpublished.terminals[0]!, 80);
    expect((await call(`/api/results/classes/${c.classId}/terminals/${unpublished.terminals[0]!}/ledger`, { cookie: coordinator.cookie })).status).toBe(404);
    // Publish the first of two terminals: its ledger exists, the final's does not.
    await call("/api/results/review/verify", { method: "POST", body: { sheetIds: [await sheetIdOf(c, sub, unpublished.terminals[0]!)] }, cookie: coordinator.cookie });
    expect((await call(`/api/results/classes/${c.classId}/publish`, { method: "POST", body: { terminalId: unpublished.terminals[0]! }, cookie: coordinator.cookie })).status).toBe(201);
    expect((await call(`/api/results/classes/${c.classId}/terminals/${unpublished.terminals[0]!}/ledger`, { cookie: coordinator.cookie })).status).toBe(200);
    expect((await call(`/api/results/classes/${c.classId}/final/ledger`, { cookie: coordinator.cookie })).status).toBe(404);
  });
});

describe("the ledger's columns", () => {
  it("are the subjects in the order the school set them up, and a subject switched off after publishing keeps its column", async () => {
    const t = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: false }]));
    const c = await resultsClass("plus2", 2, t);
    const first = await addSubject(c, { full: 100 });
    const second = await addSubject(c, { full: 50 });
    const third = await addSubject(c, { full: 100 });
    expect((await runTerminal(c, [third, first, second], t.terminals[0]!, 80, coordinator)).status).toBe(201);
    const path = `/api/results/classes/${c.classId}/terminals/${t.terminals[0]!}/ledger`;
    const ledger = (await (await call(path, { cookie: coordinator.cookie })).json()) as { subjects: { offeringId: string; name: string }[]; students: { marks: ({ valueHundredths: number } | null)[]; totalHundredths: number }[] };
    // The order they were added, not the order they were verified or published in.
    expect(ledger.subjects.map((s) => s.offeringId)).toEqual([first.offeringId, second.offeringId, third.offeringId]);
    expect(ledger.students[0]!.marks.map((m) => m!.valueHundredths)).toEqual([8000, 4000, 8000]);
    await db.prepare("UPDATE subject_offerings SET is_active = 0 WHERE public_id = ?1").bind(second.offeringId).run();
    const after = (await (await call(path, { cookie: coordinator.cookie })).json()) as { subjects: unknown[]; students: { totalHundredths: number }[] };
    expect(after.subjects).toHaveLength(3);
    expect(after.students[0]!.totalHundredths).toBe(20_000);
  });
});

describe("a recheck changes the next version, and both documents follow it", () => {
  it("the new marks, the new rank and the new total show on the ledger and the card; the old version still opens as it was", async () => {
    const pupil = a.pupils[3]!; // 40 per cent, rank 3
    const first = (await own(a, 3)).find((r) => r.kind === "terminal")!;
    const asked = await call(`/api/results/publications/${first.publicationId}/rechecks`, { method: "POST", body: { offeringId: science.offeringId, reason: "I think a page was not counted" }, cookie: pupil.person.cookie });
    expect(asked.status).toBe(201);
    const id = ((await asked.json()) as { id: string }).id;
    // Theory 75 and practical 25: full marks, so this student now ties for first.
    const decided = await call(`/api/results/rechecks/${id}/decide`, { method: "POST", body: { outcome: "changed", reason: "A page was missed", marks: [{ componentId: "theory", valueHundredths: 7500, absent: false }, { componentId: "practical", valueHundredths: 2500, absent: false }] }, cookie: coordinator.cookie });
    expect(decided.status).toBe(200);
    const now = await sheetOf(a, 3);
    expect([now.rank, now.percentHundredths, now.subjects[0]!.finalGrade]).toEqual([1, 10_000, "A+"]);
    const ledger = (await (await call(ledgerPath(a), { cookie: coordinator.cookie })).json()) as { students: { enrollmentId: string; rank: number; totalHundredths: number }[] };
    expect(ledger.students.find((s) => s.enrollmentId === pupil.enrollmentId)).toMatchObject({ rank: 1, totalHundredths: 10_000 });
    // The first card version, asked for by its id, is as it was: staff may open any version, and it ranks among the class's latest.
    const old = await call(`/api/results/grade-sheets/${first.card.id}`, { cookie: coordinator.cookie });
    expect(old.status).toBe(200);
  });
});

describe("pass marks per subject (Lahan's school setting)", () => {
  it("a subject below its own pass marks is NG with a point of 0 even when the whole percentage would pass, and no division follows", async () => {
    await setSchool(true);
    const t = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: false }]));
    const c = await resultsClass("plus2", 2, t);
    const maths = await addSubject(c, { full: 100 });
    const art = await addSubject(c, { full: 100 });
    // Maths must reach 60 of 100 to pass.
    expect((await call(`/api/academics/offerings/${maths.offeringId}`, { method: "PATCH", body: { passTheoryHundredths: 6000 }, cookie: coordinator.cookie })).status).toBe(200);
    // Pupil 0: maths 50 (below its pass marks), art 100: total 75 per cent. Pupil 1: 90 and 90.
    const marks = [[50, 100], [90, 90]];
    const published = await runTerminal(c, [maths, art], t.terminals[0]!, (p, _part, subject) => marks[p]![subject]!, coordinator);
    expect(published.status).toBe(201);
    const failing = (await (await call(`/api/results/grade-sheets/${await cardOf(c, 0)}`, { cookie: coordinator.cookie })).json()) as Sheet;
    expect(failing.subjects.map((s) => s.finalGrade)).toEqual(["NG", "A+"]);
    expect(failing.subjects[0]!.pointHundredths).toBe(0);
    expect(failing.division).toBeNull();
    expect(failing.percentHundredths).toBe(7500);
    await setSchool(false);
  });
});
