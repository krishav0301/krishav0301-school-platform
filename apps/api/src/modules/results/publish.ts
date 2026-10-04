import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { gradeResult, type GradedResult, type GradingPolicy, type SubjectMarks } from "./grading";
import { CLASS_JOINS, NAMING_COLUMNS, coordinatorFor, naming, readyToPublish, takes } from "./guard";
import type { CardBody } from "./schema";

/**
 * Publishing a class's results for a terminal (Phase 7, slice 3, D-081). CLAUDE.md section 6: results publish for a
 * whole class per terminal, and only when every subject is verified; a class with no grading policy cannot be
 * published; published marks cards are snapshots. One batch: the publication, every sheet to Published, and a card
 * for every student, each statement conditioned on the publication, which is conditioned on the class being ready.
 */

interface MarkRow {
  enrollment_id: string;
  sid: string;
  name: string;
  roll_no: number | null;
  offering_id: string;
  subject_name: string;
  credit_hundredths: number | null;
  component_id: string;
  component_name: string;
  kind: "theory" | "practical";
  max_hundredths: number;
  value_hundredths: number | null;
  absent: number;
}

export interface StudentMarks {
  enrollmentId: string;
  sid: string;
  name: string;
  rollNo: number | null;
  subjects: SubjectMarks[];
}

/**
 * Every mark of a class for a terminal, grouped by student and subject: the students who take each subject, its active
 * components, the recorded mark or absence (null when missing). `?1` the class, `?2` the terminal, `?3` one enrollment or null.
 */
export function marksQuery(db: D1Database, classId: string, terminalId: string, enrollmentId: string | null): D1PreparedStatement {
  return db
    .prepare(
      `SELECT en.public_id AS enrollment_id, st.sid, st.first_name || ' ' || st.last_name AS name, en.roll_no,
              o.public_id AS offering_id, sb.name AS subject_name, o.credit_hundredths,
              mc.public_id AS component_id, mc.name AS component_name, mc.kind, mc.max_hundredths, m.value_hundredths, COALESCE(m.absent, 0) AS absent
         FROM classes cl JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
         JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
         JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
         JOIN mark_components mc ON mc.offering_id = o.id AND mc.is_active = 1
         LEFT JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id
         LEFT JOIN marks m ON m.sheet_id = ms.id AND m.enrollment_id = en.id AND m.component_id = mc.id
        WHERE cl.public_id = ?1 AND (?3 IS NULL OR en.public_id = ?3) AND ${takes("en", "o")}
        ORDER BY en.roll_no, st.first_name, st.last_name, en.id, sb.name, o.id, mc.ordinal`,
    )
    .bind(classId, terminalId, enrollmentId);
}

export function groupMarks(rows: MarkRow[]): StudentMarks[] {
  const students: StudentMarks[] = [];
  for (const r of rows) {
    let student = students[students.length - 1];
    if (!student || student.enrollmentId !== r.enrollment_id) {
      students.push((student = { enrollmentId: r.enrollment_id, sid: r.sid, name: r.name, rollNo: r.roll_no, subjects: [] }));
    }
    let subject = student.subjects[student.subjects.length - 1];
    if (!subject || subject.offeringId !== r.offering_id) {
      student.subjects.push((subject = { offeringId: r.offering_id, name: r.subject_name, creditHundredths: r.credit_hundredths, components: [] }));
    }
    subject.components.push({ id: r.component_id, name: r.component_name, kind: r.kind, maxHundredths: r.max_hundredths, valueHundredths: r.value_hundredths, absent: r.absent === 1 });
  }
  return students;
}

export interface ClassHead {
  class_id: string;
  programme_name: string;
  level_name: string;
  label: string;
  section_name: string;
  year_label: string;
  year_status: string;
  grading_policy: GradingPolicy | null;
  terminal_name: string;
}

export const HEAD_COLUMNS = `cl.public_id AS class_id, ${NAMING_COLUMNS}, s.name AS section_name, ay.label AS year_label, ay.status AS year_status, pv.grading_policy, t.name AS terminal_name`;

/** The snapshot a marks card keeps. */
export function cardBody(head: ClassHead, policy: GradingPolicy, student: StudentMarks, graded: GradedResult): CardBody {
  return {
    student: { name: student.name, sid: student.sid, rollNo: student.rollNo },
    class: { ...naming(head), sectionName: head.section_name, yearLabel: head.year_label },
    terminal: { name: head.terminal_name },
    policy,
    subjects: graded.subjects.map((s, i) => ({
      ...s,
      components: student.subjects[i]!.components.map((c) => ({ name: c.name, kind: c.kind, maxHundredths: c.maxHundredths, valueHundredths: c.valueHundredths, absent: c.absent })),
    })),
    gpaHundredths: graded.gpaHundredths,
    percentHundredths: graded.percentHundredths,
    outcome: graded.outcome,
    passed: graded.passed,
  };
}

export type PublishResult =
  | { ok: true; publicationId: string; cards: number }
  | { ok: false; reason: "not_found" | "year_closed" | "already_published" | "no_policy" | "not_ready" }
  | { ok: false; reason: "cannot_grade"; message: string };

export async function publishClass(db: D1Database, auditKey: string, me: string, classId: string, terminalId: string): Promise<PublishResult> {
  const [headResult, marksResult] = await db.batch([
    db
      .prepare(
        `SELECT ${HEAD_COLUMNS}, ${coordinatorFor(3, "pv.section_id")} AS allowed, (${readyToPublish("t.id")}) AS ready,
                EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id) AS published
           FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN terminals t ON t.academic_year_id = ay.id AND t.public_id = ?2
          WHERE cl.public_id = ?1`,
      )
      .bind(classId, terminalId, me),
    marksQuery(db, classId, terminalId, null),
  ]);
  const head = headResult!.results[0] as unknown as (ClassHead & { allowed: number; ready: number; published: number }) | undefined;
  if (!head || head.allowed !== 1) return { ok: false, reason: "not_found" };
  if (head.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (head.published === 1) return { ok: false, reason: "already_published" };
  if (!head.grading_policy) return { ok: false, reason: "no_policy" };
  if (head.ready !== 1) return { ok: false, reason: "not_ready" };
  const policy = head.grading_policy;

  const students = groupMarks(marksResult!.results as unknown as MarkRow[]);
  const cards: { e: string; id: string; g: number | null; p: number | null; s: number; o: string; b: string }[] = [];
  try {
    for (const student of students) {
      const graded = gradeResult(policy, student.subjects);
      cards.push({ e: student.enrollmentId, id: newPublicId(), g: graded.gpaHundredths, p: graded.percentHundredths, s: graded.passed ? 1 : 0, o: graded.outcome, b: JSON.stringify(cardBody(head, policy, student, graded)) });
    }
  } catch (error) {
    return { ok: false, reason: "cannot_grade", message: error instanceof Error ? error.message : String(error) };
  }

  const publicationId = newPublicId();
  const at = new Date().toISOString();
  const publication = db
    .prepare(
      `INSERT INTO result_publications (public_id, class_id, terminal_id, grading_policy, published_by_user_id, published_at)
       SELECT ?4, cl.id, t.id, ?5, (SELECT id FROM users WHERE public_id = ?3), ?6
         FROM classes cl ${CLASS_JOINS} JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
        WHERE cl.public_id = ?1 AND pv.grading_policy = ?5 AND ${coordinatorFor(3, "pv.section_id")} AND ${readyToPublish("t.id")}`,
    )
    .bind(classId, terminalId, me, publicationId, policy, at);
  const sheets = db
    .prepare(
      `UPDATE mark_sheets SET status = 'published', updated_at = ?2
        WHERE class_id = (SELECT class_id FROM result_publications WHERE public_id = ?1) AND terminal_id = (SELECT terminal_id FROM result_publications WHERE public_id = ?1)
          AND status = 'verified'`,
    )
    .bind(publicationId, at);
  const cardInsert = db
    .prepare(
      `INSERT INTO marks_cards (public_id, publication_id, enrollment_id, version, gpa_hundredths, percent_hundredths, passed, outcome, body, created_by_user_id, created_at)
       SELECT json_extract(j.value, '$.id'), rp.id, en.id, 1, json_extract(j.value, '$.g'), json_extract(j.value, '$.p'), json_extract(j.value, '$.s'),
              json_extract(j.value, '$.o'), json_extract(j.value, '$.b'), rp.published_by_user_id, ?3
         FROM result_publications rp JOIN json_each(?2) j
         JOIN enrollments en ON en.public_id = json_extract(j.value, '$.e') AND en.class_id = rp.class_id
        WHERE rp.public_id = ?1`,
    )
    .bind(publicationId, JSON.stringify(cards), at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.published",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: me,
        summary: `Results published for ${head.terminal_name}`,
        after: { terminalId, publicationId, policy, cards: cards.length },
      },
      [publication, sheets, cardInsert],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true, publicationId, cards: cards.length } : { ok: false, reason: "not_ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    if (/UNIQUE constraint failed: result_publications/i.test(message)) return { ok: false, reason: "already_published" };
    throw error;
  }
}
