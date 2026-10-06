import { newPublicId } from "../src/core/ids";
import { getExamPattern, saveExamPattern } from "../src/modules/academics/service";
import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";
import { assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * Results fixtures on the exam pattern (D-114): a term of its own with its pattern (made through the service, as the
 * Co-ordinator would), classes in it, and subjects with their paper (full marks, and a practical when they have one),
 * each with a teacher. Plain SQL for what Phase 3 already tests; the results flows themselves go through the real API.
 */

export interface PatternInput {
  graded: boolean;
  theoryMinPercent: number;
  practicalMinPercent: number;
  gradeBands: { grade: string; from: number }[] | null;
  terminals: { name: string; weight: number; hasPractical: boolean }[];
}

export const BANDS = [
  { grade: "A+", from: 90 },
  { grade: "A", from: 80 },
  { grade: "B+", from: 70 },
  { grade: "B", from: 60 },
  { grade: "C+", from: 50 },
  { grade: "C", from: 40 },
  { grade: "D", from: 35 },
];

/** The PM's example: graded or not, three terminals of 30, 30 and 40, the practical in the last two. */
export const pattern = (graded: boolean, terminals: PatternInput["terminals"] = THREE): PatternInput => ({ graded, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: graded ? BANDS : null, terminals });
export const THREE: PatternInput["terminals"] = [
  { name: "First terminal", weight: 30, hasPractical: false },
  { name: "Second terminal", weight: 30, hasPractical: true },
  { name: "Final", weight: 40, hasPractical: true },
];

export interface Term {
  yearId: string;
  /** The terminals' ids, in order. */
  terminals: string[];
}

let coordinator: Person | null = null;
let n = 0;
/** A new open term with its exam pattern. Several terms may be open at once (D-110). */
export async function examTerm(input: PatternInput): Promise<Term> {
  await seedSections();
  coordinator ??= await person("coordinator", "institution");
  const yearId = newPublicId();
  const code = `R${++n}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await db
    .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, 2083, ?2, ?3, '2026-04-14', '2027-04-13', 'active', '2026-04-14T00:00:00Z')`)
    .bind(yearId, code, `Term ${code}`)
    .run();
  const saved = await saveExamPattern(db, auditKey, coordinator.publicId, yearId, input);
  if (!saved.ok) throw new Error(`pattern setup failed: ${JSON.stringify(saved)}`);
  return { yearId, terminals: (await getExamPattern(db, yearId))!.terminals.map((t) => t.id) };
}

export interface Subject {
  offeringId: string;
  teacher: Person;
  name: string;
}

let s = 0;
/** Adds a subject at the class's level with its paper (default out of 100, no practical) and a teacher; optionally in an elective group. */
export async function addSubject(
  fixture: ClassFixture,
  paper: { full?: number; practical?: number | null } = {},
  options: { groupId?: string; teacher?: Person; section?: "plus2" | "bachelors" } = {},
): Promise<Subject> {
  const subjectId = newPublicId();
  const name = `Results subject ${++s}${Math.random().toString(36).slice(2, 6)}`;
  await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subjectId, name).run();
  const offeringId = newPublicId();
  await db
    .prepare(
      `INSERT INTO subject_offerings (public_id, level_id, subject_id, elective_group_id, full_marks_hundredths, practical_hundredths)
       SELECT ?1, l.id, s.id, (SELECT id FROM elective_groups WHERE public_id = ?4), ?5, ?6 FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3`,
    )
    .bind(offeringId, fixture.levelId, subjectId, options.groupId ?? null, (paper.full ?? 100) * 100, paper.practical == null ? null : paper.practical * 100)
    .run();
  const teacher = options.teacher ?? (await teacherIn(options.section ?? "plus2"));
  await assign(teacher, fixture.classId, offeringId);
  return { offeringId, teacher, name };
}

/** A class in the term, the fixture's own subject switched off (so only the subjects added here count). */
export async function resultsClass(section: "plus2" | "bachelors", size: number, term: Term): Promise<ClassFixture> {
  const fixture = await classWith(section, size, { yearId: term.yearId });
  await db.prepare("UPDATE subject_offerings SET is_active = 0 WHERE public_id = ?1").bind(fixture.offeringId).run();
  return fixture;
}

const sheetPath = (fixture: ClassFixture, subject: Subject, terminalId: string) => `/api/results/classes/${fixture.classId}/subjects/${subject.offeringId}/terminals/${terminalId}`;

interface Sheet {
  components: { id: "theory" | "practical"; maxHundredths: number }[];
  students: { enrollmentId: string }[];
}

/** The parts of a sheet as the teacher sees them (theory, and the practical where the terminal holds it). */
export async function partsOf(fixture: ClassFixture, subject: Subject, terminalId: string): Promise<Sheet["components"]> {
  const sheet = (await (await call(sheetPath(fixture, subject, terminalId), { cookie: subject.teacher.cookie })).json()) as Sheet;
  return sheet.components;
}

/**
 * The teacher enters a percentage of each part for every student (the same, or per student and part: 0 theory, 1
 * practical; null for absent), and submits.
 */
export async function enterAndSubmit(fixture: ClassFixture, subject: Subject, terminalId: string, percent: number | ((pupil: number, part: number) => number | null), submit = true): Promise<void> {
  const sheet = (await (await call(sheetPath(fixture, subject, terminalId), { cookie: subject.teacher.cookie })).json()) as Sheet;
  const takers = new Set(sheet.students.map((x) => x.enrollmentId));
  const marks = fixture.pupils
    .map((p, pi) => ({ p, pi }))
    .filter(({ p }) => takers.has(p.enrollmentId))
    .flatMap(({ p, pi }) =>
      sheet.components.map((c, ci) => {
        const pct = typeof percent === "number" ? percent : percent(pi, ci);
        return pct === null
          ? { enrollmentId: p.enrollmentId, componentId: c.id, valueHundredths: null, absent: true }
          : { enrollmentId: p.enrollmentId, componentId: c.id, valueHundredths: Math.round((c.maxHundredths * pct) / 100), absent: false };
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

/** Every subject of the class through one terminal: entered, submitted, verified and published by the Co-ordinator. */
export async function runTerminal(fixture: ClassFixture, subjects: Subject[], terminalId: string, percent: number | ((pupil: number, part: number, subject: number) => number | null), who: Person): Promise<Response> {
  for (const [si, subject] of subjects.entries()) await enterAndSubmit(fixture, subject, terminalId, typeof percent === "number" ? percent : (p, c) => percent(p, c, si));
  const ids = await Promise.all(subjects.map((x) => sheetIdOf(fixture, x, terminalId)));
  await call("/api/results/review/verify", { method: "POST", body: { sheetIds: ids }, cookie: who.cookie });
  return call(`/api/results/classes/${fixture.classId}/publish`, { method: "POST", body: { terminalId }, cookie: who.cookie });
}

export { sheetPath };
