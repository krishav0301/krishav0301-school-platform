import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { finalResult, terminalResult, type FinalResult, type Paper, type PatternRules, type SubjectPapers, type TerminalResult } from "./grading";
import { CLASS_JOINS, NAMING_COLUMNS, coordinatorFor, naming, readyToPublish, takes } from "./guard";
import type { FinalCardBody, PatternSnapshot, TerminalCardBody } from "./schema";

/**
 * Publishing a class's results for a terminal (Phase 7, slice 3, D-081; on the exam pattern since D-114). CLAUDE.md
 * section 6: results publish for a whole class per terminal, and only when every subject is verified; published marks
 * cards are snapshots. D-114: a class with no exam pattern cannot be published; a terminal's card is for information
 * (no pass or fail); when the class's last terminal is published, its final result is published with it, in the same
 * batch: every terminal scaled to its weight and added, out of 100, pass or fail.
 */

/** One row per student, subject, terminal: the paper's maxima (as its sheet was made, or as it would be) and the marks. */
interface MarkRow {
  enrollment_id: string;
  sid: string;
  name: string;
  roll_no: number | null;
  offering_id: string;
  subject_name: string;
  terminal_id: string;
  terminal_name: string;
  weight: number;
  theory_max: number;
  practical_max: number | null;
  has_sheet: number;
  theory_value: number | null;
  theory_absent: number | null;
  practical_value: number | null;
  practical_absent: number | null;
}

export interface StudentPapers {
  enrollmentId: string;
  sid: string;
  name: string;
  rollNo: number | null;
  subjects: SubjectPapers[];
}

/**
 * Every mark of a class: the students who take each subject, every terminal of the term in the pattern (or only `?2`),
 * each paper's parts and the recorded mark or absence. `?1` the class, `?2` one terminal or null, `?3` one enrollment or null.
 */
export function marksQuery(db: D1Database, classId: string, terminalId: string | null, enrollmentId: string | null): D1PreparedStatement {
  return db
    .prepare(
      `SELECT en.public_id AS enrollment_id, st.sid, st.first_name || ' ' || st.last_name AS name, en.roll_no,
              o.public_id AS offering_id, sb.name AS subject_name, t.public_id AS terminal_id, t.name AS terminal_name, t.weight,
              COALESCE(ms.theory_max_hundredths, CASE WHEN t.has_practical = 1 AND o.practical_hundredths IS NOT NULL THEN o.full_marks_hundredths - o.practical_hundredths ELSE o.full_marks_hundredths END) AS theory_max,
              CASE WHEN ms.id IS NOT NULL THEN ms.practical_max_hundredths WHEN t.has_practical = 1 THEN o.practical_hundredths END AS practical_max,
              ms.id IS NOT NULL AS has_sheet,
              mt.value_hundredths AS theory_value, mt.absent AS theory_absent, mp.value_hundredths AS practical_value, mp.absent AS practical_absent
         FROM classes cl JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.weight IS NOT NULL AND (?2 IS NULL OR t.public_id = ?2)
         JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
         JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
         LEFT JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id
         LEFT JOIN marks mt ON mt.sheet_id = ms.id AND mt.enrollment_id = en.id AND mt.part = 'theory'
         LEFT JOIN marks mp ON mp.sheet_id = ms.id AND mp.enrollment_id = en.id AND mp.part = 'practical'
        WHERE cl.public_id = ?1 AND (?3 IS NULL OR en.public_id = ?3) AND ${takes("en", "o")}
        ORDER BY en.roll_no, st.first_name, st.last_name, en.id, sb.name, o.id, t.ordinal`,
    )
    .bind(classId, terminalId, enrollmentId);
}

/**
 * Groups the rows by student and subject. With `missingIsAbsent` (the final result), a paper with no mark at all counts
 * as an absence: a student who joined after a terminal was published (OPEN: D-114's stated default, an absence is 0).
 * Without it (one terminal), a missing mark stays missing and the calculation refuses it.
 */
export function groupPapers(rows: MarkRow[], missingIsAbsent: boolean): StudentPapers[] {
  const students: StudentPapers[] = [];
  const part = (max: number, value: number | null, absent: number | null) => ({
    maxHundredths: max,
    valueHundredths: value,
    absent: absent === 1 || (missingIsAbsent && value === null),
  });
  for (const r of rows) {
    let student = students[students.length - 1];
    if (!student || student.enrollmentId !== r.enrollment_id) {
      students.push((student = { enrollmentId: r.enrollment_id, sid: r.sid, name: r.name, rollNo: r.roll_no, subjects: [] }));
    }
    let subject = student.subjects[student.subjects.length - 1];
    if (!subject || subject.offeringId !== r.offering_id) student.subjects.push((subject = { offeringId: r.offering_id, name: r.subject_name, papers: [] }));
    const paper: Paper = {
      terminalId: r.terminal_id,
      terminalName: r.terminal_name,
      weight: r.weight,
      theory: part(r.theory_max, r.theory_value, r.theory_absent),
      practical: r.practical_max === null ? null : part(r.practical_max, r.practical_value, r.practical_absent),
    };
    subject.papers.push(paper);
  }
  return students;
}

/** The class's names and its term's pattern, as a card keeps them. */
export interface ClassHead {
  class_id: string;
  programme_name: string;
  level_name: string;
  label: string;
  section_name: string;
  year_label: string;
  year_status: string;
  graded: number | null;
  theory_min_percent: number | null;
  practical_min_percent: number | null;
  grade_bands: string | null;
  terminals: string;
}

export const HEAD_COLUMNS = `cl.public_id AS class_id, ${NAMING_COLUMNS}, s.name AS section_name, ay.label AS year_label, ay.status AS year_status,
  ep.graded, ep.theory_min_percent, ep.practical_min_percent, ep.grade_bands,
  (SELECT json_group_array(json_object('id', x.public_id, 'name', x.name, 'weight', x.weight)) FROM (SELECT * FROM terminals WHERE academic_year_id = ay.id AND weight IS NOT NULL ORDER BY ordinal) x) AS terminals`;

/** The joins `HEAD_COLUMNS` needs after `classes cl ${CLASS_JOINS}`. */
export const HEAD_JOINS = `JOIN academic_years ay ON ay.id = cl.academic_year_id LEFT JOIN exam_patterns ep ON ep.academic_year_id = ay.id`;

/** The pattern of a head, or null when the term has none. */
export function patternOf(head: ClassHead): PatternSnapshot | null {
  if (head.graded === null) return null;
  return {
    graded: head.graded === 1,
    theoryMinPercent: head.theory_min_percent!,
    practicalMinPercent: head.practical_min_percent!,
    gradeBands: head.grade_bands === null ? null : (JSON.parse(head.grade_bands) as { grade: string; from: number }[]),
    terminals: JSON.parse(head.terminals) as { id: string; name: string; weight: number }[],
  };
}

const rulesOf = (p: PatternSnapshot): PatternRules => ({ graded: p.graded, theoryMinPercent: p.theoryMinPercent, practicalMinPercent: p.practicalMinPercent, gradeBands: p.gradeBands });

const studentOf = (s: StudentPapers) => ({ name: s.name, sid: s.sid, rollNo: s.rollNo });
const classOf = (head: ClassHead) => ({ ...naming(head), sectionName: head.section_name, yearLabel: head.year_label });

export function terminalCard(head: ClassHead, pattern: PatternSnapshot, terminal: { name: string; weight: number }, student: StudentPapers): { result: TerminalResult; body: TerminalCardBody } {
  const result = terminalResult(rulesOf(pattern), student.subjects);
  return {
    result,
    body: {
      kind: "terminal",
      student: studentOf(student),
      class: classOf(head),
      terminal,
      graded: pattern.graded,
      subjects: result.subjects.map(({ passed: _passed, ...s }) => s),
      percentHundredths: result.percentHundredths,
      grade: result.grade,
      outcome: result.outcome,
    },
  };
}

export function finalCard(head: ClassHead, pattern: PatternSnapshot, student: StudentPapers): { result: FinalResult; body: FinalCardBody } {
  const result = finalResult(rulesOf(pattern), student.subjects);
  return {
    result,
    body: { kind: "final", student: studentOf(student), class: classOf(head), pattern, subjects: result.subjects, percentHundredths: result.percentHundredths, passed: result.passed, grade: result.grade, outcome: result.outcome },
  };
}

/** The cards to insert: one row each, read by `json_each` in the insert. */
interface CardRow {
  e: string;
  id: string;
  p: number;
  s: number | null;
  o: string;
  b: string;
}

/** Inserts version 1 of every card in `?2` for the publication `?1`, made at `?3`. */
const insertCards = (db: D1Database, publicationId: string, cards: CardRow[], at: string) =>
  db
    .prepare(
      `INSERT INTO marks_cards (public_id, publication_id, enrollment_id, version, percent_hundredths, passed, outcome, body, created_by_user_id, created_at)
       SELECT json_extract(j.value, '$.id'), rp.id, en.id, 1, json_extract(j.value, '$.p'), json_extract(j.value, '$.s'),
              json_extract(j.value, '$.o'), json_extract(j.value, '$.b'), rp.published_by_user_id, ?3
         FROM result_publications rp JOIN json_each(?2) j
         JOIN enrollments en ON en.public_id = json_extract(j.value, '$.e') AND en.class_id = rp.class_id
        WHERE rp.public_id = ?1`,
    )
    .bind(publicationId, JSON.stringify(cards), at);

export type PublishResult =
  | { ok: true; publicationId: string; cards: number; finalPublicationId: string | null }
  | { ok: false; reason: "not_found" | "year_closed" | "already_published" | "no_pattern" | "not_ready" }
  | { ok: false; reason: "cannot_grade"; message: string };

export async function publishClass(db: D1Database, auditKey: string, me: string, classId: string, terminalId: string): Promise<PublishResult> {
  const [headResult, marksResult] = await db.batch([
    db
      .prepare(
        `SELECT ${HEAD_COLUMNS}, ${coordinatorFor(3, "pv.section_id")} AS allowed, (${readyToPublish("t.id")}) AS ready, t.name AS terminal_name, t.weight,
                EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id) AS published,
                (SELECT COUNT(*) FROM terminals o2 WHERE o2.academic_year_id = ay.id AND o2.weight IS NOT NULL AND o2.id <> t.id
                    AND NOT EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = o2.id)) AS others_unpublished
           FROM classes cl ${CLASS_JOINS} ${HEAD_JOINS}
           JOIN terminals t ON t.academic_year_id = ay.id AND t.public_id = ?2
          WHERE cl.public_id = ?1`,
      )
      .bind(classId, terminalId, me),
    // Every terminal's marks: this terminal's for its cards, all of them for the final when this is the last.
    marksQuery(db, classId, null, null),
  ]);
  const head = headResult!.results[0] as unknown as (ClassHead & { allowed: number; ready: number; published: number; others_unpublished: number; terminal_name: string; weight: number | null }) | undefined;
  if (!head || head.allowed !== 1) return { ok: false, reason: "not_found" };
  if (head.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (head.published === 1) return { ok: false, reason: "already_published" };
  const pattern = patternOf(head);
  if (!pattern || head.weight === null) return { ok: false, reason: "no_pattern" };
  if (head.ready !== 1) return { ok: false, reason: "not_ready" };
  const isLast = head.others_unpublished === 0;

  const rows = marksResult!.results as unknown as MarkRow[];
  const terminalCards: CardRow[] = [];
  const finalCards: CardRow[] = [];
  try {
    for (const student of groupPapers(
      rows.filter((r) => r.terminal_id === terminalId),
      false,
    )) {
      const { result, body } = terminalCard(head, pattern, { name: head.terminal_name, weight: head.weight }, student);
      terminalCards.push({ e: student.enrollmentId, id: newPublicId(), p: result.percentHundredths, s: null, o: result.outcome, b: JSON.stringify(body) });
    }
    if (isLast) {
      for (const student of groupPapers(rows, true)) {
        const { result, body } = finalCard(head, pattern, student);
        finalCards.push({ e: student.enrollmentId, id: newPublicId(), p: result.percentHundredths, s: result.passed ? 1 : 0, o: result.outcome, b: JSON.stringify(body) });
      }
    }
  } catch (error) {
    return { ok: false, reason: "cannot_grade", message: error instanceof Error ? error.message : String(error) };
  }

  const publicationId = newPublicId();
  const finalPublicationId = isLast ? newPublicId() : null;
  const at = new Date().toISOString();
  const snapshot = JSON.stringify(pattern);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO result_publications (public_id, class_id, terminal_id, pattern, published_by_user_id, published_at)
         SELECT ?4, cl.id, t.id, ?5, (SELECT id FROM users WHERE public_id = ?3), ?6
           FROM classes cl ${CLASS_JOINS} JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
          WHERE cl.public_id = ?1 AND ${coordinatorFor(3, "pv.section_id")} AND ${readyToPublish("t.id")}
            AND EXISTS (SELECT 1 FROM exam_patterns ep WHERE ep.academic_year_id = cl.academic_year_id)`,
      )
      .bind(classId, terminalId, me, publicationId, snapshot, at),
    db
      .prepare(
        `UPDATE mark_sheets SET status = 'published', updated_at = ?2
          WHERE class_id = (SELECT class_id FROM result_publications WHERE public_id = ?1) AND terminal_id = (SELECT terminal_id FROM result_publications WHERE public_id = ?1)
            AND status = 'verified'`,
      )
      .bind(publicationId, at),
    insertCards(db, publicationId, terminalCards, at),
  ];
  if (finalPublicationId) {
    // The final, only if this terminal's publication went in and every terminal of the term is now published.
    statements.push(
      db
        .prepare(
          `INSERT INTO result_publications (public_id, class_id, terminal_id, pattern, published_by_user_id, published_at)
           SELECT ?2, rp.class_id, NULL, rp.pattern, rp.published_by_user_id, rp.published_at
             FROM result_publications rp JOIN classes cl ON cl.id = rp.class_id
            WHERE rp.public_id = ?1
              AND NOT EXISTS (SELECT 1 FROM terminals t WHERE t.academic_year_id = cl.academic_year_id AND t.weight IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM result_publications x WHERE x.class_id = cl.id AND x.terminal_id = t.id))`,
        )
        .bind(publicationId, finalPublicationId),
      insertCards(db, finalPublicationId, finalCards, at),
    );
  }
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.published",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: me,
        summary: isLast ? `Results published for ${head.terminal_name}, and the final result` : `Results published for ${head.terminal_name}`,
        after: { terminalId, publicationId, finalPublicationId, cards: terminalCards.length, finalCards: finalCards.length },
      },
      statements,
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true, publicationId, cards: terminalCards.length, finalPublicationId } : { ok: false, reason: "not_ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    if (/UNIQUE constraint failed: result_publications/i.test(message)) return { ok: false, reason: "already_published" };
    throw error;
  }
}
