import { newPublicId } from "../src/core/ids";
import { call, db, type Person } from "./academics-helpers";
import { activeYear, assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * Phase 7 fixtures: a class (from the Phase 5 fixture) whose programme has a grading policy, a terminal of the active
 * year, and subjects with mark components and credit hours, each with a teacher. Plain SQL for what Phase 3 already
 * tests; the results flows themselves go through the real API.
 */

let terminalPublicId: string | null = null;
let terminalCount = 0;
/** A terminal of the active year (a fresh one when `fresh`). */
export async function terminal(fresh = false): Promise<string> {
  if (terminalPublicId && !fresh) return terminalPublicId;
  const yearId = await activeYear();
  const id = newPublicId();
  const ordinal = (await db.prepare("SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.public_id = ?1").bind(yearId).first<{ n: number }>())!.n;
  await db.prepare("INSERT INTO terminals (public_id, academic_year_id, name, ordinal) SELECT ?1, id, ?2, ?3 FROM academic_years WHERE public_id = ?4").bind(id, `Terminal ${++terminalCount}`, ordinal, yearId).run();
  if (!fresh) terminalPublicId = id;
  return id;
}

export interface Subject {
  offeringId: string;
  teacher: Person;
  components: { id: string; max: number; kind: "theory" | "practical" }[];
}

let n = 0;
/** Adds a subject at the class's level with components (max marks, whole numbers) and a teacher; optionally in an elective group. */
export async function addSubject(fixture: ClassFixture, components: [number, "theory" | "practical"][], options: { credit?: number | null; groupId?: string; teacher?: Person; section?: "plus2" | "bachelors" } = {}): Promise<Subject> {
  const subjectId = newPublicId();
  await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subjectId, `Results subject ${++n}${Math.random().toString(36).slice(2, 6)}`).run();
  const offeringId = newPublicId();
  await db
    .prepare(
      `INSERT INTO subject_offerings (public_id, level_id, subject_id, credit_hundredths, elective_group_id)
       SELECT ?1, l.id, s.id, ?4, (SELECT id FROM elective_groups WHERE public_id = ?5) FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3`,
    )
    .bind(offeringId, fixture.levelId, subjectId, options.credit === undefined ? 400 : options.credit === null ? null : options.credit * 100, options.groupId ?? null)
    .run();
  const made: Subject["components"] = [];
  for (const [i, [max, kind]] of components.entries()) {
    const id = newPublicId();
    await db
      .prepare("INSERT INTO mark_components (public_id, offering_id, name, max_hundredths, ordinal, kind) SELECT ?1, id, ?2, ?3, ?4, ?5 FROM subject_offerings WHERE public_id = ?6")
      .bind(id, kind === "theory" ? `Theory ${i + 1}` : `Practical ${i + 1}`, max * 100, i + 1, kind, offeringId)
      .run();
    made.push({ id, max, kind });
  }
  const teacher = options.teacher ?? (await teacherIn(options.section ?? "plus2"));
  await assign(teacher, fixture.classId, offeringId);
  return { offeringId, teacher, components: made };
}

/** Sets the class's programme grading policy directly (the API route is tested on its own). */
export async function setPolicy(fixture: ClassFixture, policy: "neb_gpa" | "percentage_division" | null): Promise<void> {
  await db.prepare("UPDATE programmes SET grading_policy = ?1 WHERE id = (SELECT programme_id FROM levels WHERE public_id = ?2)").bind(policy, fixture.levelId).run();
}

/** A class with a policy, the fixture's own (componentless) offering switched off, and the given subjects. */
export async function resultsClass(section: "plus2" | "bachelors", size: number, policy: "neb_gpa" | "percentage_division" | null = "neb_gpa"): Promise<ClassFixture> {
  const fixture = await classWith(section, size);
  await setPolicy(fixture, policy);
  await db.prepare("UPDATE subject_offerings SET is_active = 0 WHERE public_id = ?1").bind(fixture.offeringId).run();
  return fixture;
}

const sheetPath = (fixture: ClassFixture, subject: Subject, terminalId: string) => `/api/results/classes/${fixture.classId}/subjects/${subject.offeringId}/terminals/${terminalId}`;

/** The teacher enters the same percentage for every student and component (or per student), and submits. */
export async function enterAndSubmit(fixture: ClassFixture, subject: Subject, terminalId: string, percent: number | ((pupil: number, component: number) => number), submit = true): Promise<void> {
  const marks = fixture.pupils.flatMap((p, pi) =>
    subject.components.map((c, ci) => {
      const pct = typeof percent === "number" ? percent : percent(pi, ci);
      return { enrollmentId: p.enrollmentId, componentId: c.id, valueHundredths: Math.round(c.max * pct), absent: false };
    }),
  );
  const saved = await call(sheetPath(fixture, subject, terminalId), { method: "PUT", body: { marks }, cookie: subject.teacher.cookie });
  if (saved.status !== 200) throw new Error(`save failed ${saved.status} ${await saved.text()}`);
  if (submit) {
    const sent = await call(`${sheetPath(fixture, subject, terminalId)}/submit`, { method: "POST", cookie: subject.teacher.cookie });
    if (sent.status !== 200) throw new Error(`submit failed ${sent.status} ${await sent.text()}`);
  }
}

export const sheetIdOf = async (fixture: ClassFixture, subject: Subject, terminalId: string): Promise<string> =>
  (await db
    .prepare("SELECT ms.public_id FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id JOIN subject_offerings o ON o.id = ms.offering_id JOIN terminals t ON t.id = ms.terminal_id WHERE c.public_id = ?1 AND o.public_id = ?2 AND t.public_id = ?3")
    .bind(fixture.classId, subject.offeringId, terminalId)
    .first<{ public_id: string }>())!.public_id;

export { sheetPath };
