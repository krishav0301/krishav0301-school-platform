import { GradeSheetSchema as GradeSheetConfigSchema, type GradeSheetConfig } from "../../core/config/pack";
import { adToBsText } from "../../core/dates";
import { buildGradeSheet, buildLedger, type ClassCard, type LedgerStudent } from "./gradesheet";
import { CLASS_JOINS, NAMING_COLUMNS, sectionInReach, type Reach } from "./guard";
import type { CardBody, GradeSheet, MarkLedger } from "./schema";

/**
 * The grade-point marks card and the mark ledger, read for the school that has them (the PM, 2026-10-28). Both are made
 * from the latest stored card of each student, one round trip each. A school without the layout in its file gets null.
 */

const bsOf = (iso: string) => adToBsText(iso.slice(0, 10));

/** The latest card of each (publication, enrollment): a join condition on `mc`. */
const LATEST = `mc.version = (SELECT MAX(v.version) FROM marks_cards v WHERE v.publication_id = mc.publication_id AND v.enrollment_id = mc.enrollment_id)`;

interface SchoolRow {
  name: string;
  grade_sheet_json: string | null;
}

/** The school's layout, or null when its file has none (or one that no longer reads). */
function configOf(row: SchoolRow | undefined): { school: GradeSheet["school"]; config: GradeSheetConfig } | null {
  if (!row?.grade_sheet_json) return null;
  const parsed = GradeSheetConfigSchema.safeParse(JSON.parse(row.grade_sheet_json));
  if (!parsed.success) return null;
  return { school: { name: row.name, address: parsed.data.address, contact: parsed.data.contact ?? null, crest: parsed.data.crest ?? null }, config: parsed.data };
}

/** "Two(B)" the way the paper writes a class: the level, and the section's letter in brackets. */
const classText = (r: { level_name: string; label: string }) => (r.label ? `${r.level_name}(${r.label})` : r.level_name);

const SCHOOL = `SELECT name, grade_sheet_json FROM school WHERE id = 1`;

/**
 * The marks card of one card id as a grade-point sheet. `viewer`: a student, found by their sign-in and shown only their own
 * card; or staff, whose reach must cover the class, or a Class Teacher (`classTeacher`) for a class they lead. Null when there is no such card for them, or the school has no such layout.
 */
export async function gradeSheetFor(db: D1Database, viewer: { student: string } | { reach: Reach; classTeacher?: string | null }, cardId: string): Promise<GradeSheet | null> {
  const student = "student" in viewer ? viewer.student : null;
  const reach: Reach = "reach" in viewer ? viewer.reach : { institution: 0, sections: null };
  const classTeacher = "reach" in viewer ? (viewer.classTeacher ?? null) : null;
  const [school, card, latest] = await db.batch([
    db.prepare(SCHOOL),
    db
      .prepare(
        `SELECT mc.public_id AS card_id, mc.version, mc.body, rp.id AS publication_id, rp.published_at, en.public_id AS enrollment_id, en.roll_no, st.dob_ad, trim(st.first_name || ' ' || COALESCE(st.middle_name || ' ', '') || st.last_name) AS student_name, ${NAMING_COLUMNS}
           FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id JOIN classes cl ON cl.id = rp.class_id ${CLASS_JOINS}
           JOIN enrollments en ON en.id = mc.enrollment_id JOIN students st ON st.id = en.student_id
          WHERE mc.public_id = ?1
            AND ((?2 IS NOT NULL AND st.user_id = (SELECT id FROM users WHERE public_id = ?2)) OR (?2 IS NULL AND ${sectionInReach(3)} AND (?5 IS NULL OR cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?5))))`,
      )
      .bind(cardId, student, reach.institution, reach.sections, classTeacher),
    // Every student's latest card in the same publication: for the highest grade point, the rank and the class size. Only totals are kept.
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, mc.body
           FROM marks_cards mc JOIN enrollments en ON en.id = mc.enrollment_id
          WHERE mc.publication_id = (SELECT publication_id FROM marks_cards WHERE public_id = ?1) AND ${LATEST}`,
      )
      .bind(cardId),
  ]);
  const layout = configOf(school!.results[0] as SchoolRow | undefined);
  const row = card!.results[0] as { card_id: string; version: number; body: string; published_at: string; enrollment_id: string; roll_no: number | null; dob_ad: string | null; student_name: string; level_name: string; label: string } | undefined;
  if (!layout || !row) return null;
  const classCards: ClassCard[] = (latest!.results as unknown as { enrollment_id: string; body: string }[]).map((r) => ({ enrollmentId: r.enrollment_id, body: JSON.parse(r.body) as CardBody }));
  const body = JSON.parse(row.body) as CardBody;
  // Asked for an older version: it stands in place of that student's latest, so the sheet shows what that card said.
  const among = classCards.some((c) => c.enrollmentId === row.enrollment_id) ? classCards.map((c) => (c.enrollmentId === row.enrollment_id ? { ...c, body } : c)) : [...classCards, { enrollmentId: row.enrollment_id, body }];
  return buildGradeSheet(
    layout.config,
    { school: layout.school, cardId: row.card_id, version: row.version, enrollmentId: row.enrollment_id, className: classText(row), dateOfBirthBs: row.dob_ad ? bsOf(row.dob_ad) : null, rollNo: row.roll_no, studentName: row.student_name, issuedOnBs: bsOf(row.published_at) },
    body,
    among,
  );
}

/**
 * The mark ledger of a class for a terminal, or for the final result (`terminalId` null). `classTeacher`: only a class this
 * person leads. Null when not published, not in reach, or the school has no such layout.
 */
export async function ledgerFor(db: D1Database, reach: Reach, classId: string, terminalId: string | null, classTeacher: string | null = null): Promise<MarkLedger | null> {
  const [school, head, cards, offerings] = await db.batch([
    db.prepare(SCHOOL),
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, ay.label AS year_label, t.name AS terminal_name
           FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN result_publications rp ON rp.class_id = cl.id
           LEFT JOIN terminals t ON t.id = rp.terminal_id
          WHERE cl.public_id = ?1 AND (CASE WHEN ?2 IS NULL THEN rp.terminal_id IS NULL ELSE t.public_id = ?2 END) AND ${sectionInReach(3)}
            AND (?5 IS NULL OR cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?5))`,
      )
      .bind(classId, terminalId, reach.institution, reach.sections, classTeacher),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, en.roll_no, trim(st.first_name || ' ' || COALESCE(st.middle_name || ' ', '') || st.last_name) AS student_name, mc.body
           FROM classes cl JOIN result_publications rp ON rp.class_id = cl.id LEFT JOIN terminals t ON t.id = rp.terminal_id
           JOIN marks_cards mc ON mc.publication_id = rp.id AND ${LATEST} JOIN enrollments en ON en.id = mc.enrollment_id JOIN students st ON st.id = en.student_id
          WHERE cl.public_id = ?1 AND (CASE WHEN ?2 IS NULL THEN rp.terminal_id IS NULL ELSE t.public_id = ?2 END)
          ORDER BY en.roll_no IS NULL, en.roll_no, en.id`,
      )
      .bind(classId, terminalId),
    // The subjects in the order the school set them up, with the short name the paper uses.
    db
      .prepare(
        `SELECT o.public_id AS offering_id, sb.name, sb.code
           FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id JOIN subjects sb ON sb.id = o.subject_id
          WHERE cl.public_id = ?1 ORDER BY o.id`,
      )
      .bind(classId),
  ]);
  const layout = configOf(school!.results[0] as SchoolRow | undefined);
  const h = head!.results[0] as { class_id: string; level_name: string; label: string; year_label: string; terminal_name: string | null } | undefined;
  if (!layout || !h) return null;
  const students: LedgerStudent[] = (cards!.results as unknown as { enrollment_id: string; roll_no: number | null; student_name: string; body: string }[]).map((r) => {
    const body = JSON.parse(r.body) as CardBody;
    return { enrollmentId: r.enrollment_id, body, name: r.student_name, rollNo: r.roll_no };
  });
  const subjects = (offerings!.results as unknown as { offering_id: string; name: string; code: string | null }[]).map((o) => ({ offeringId: o.offering_id, name: o.name, code: o.code }));
  return buildLedger(layout.config, { classId: h.class_id, school: layout.school, yearLabel: h.year_label, className: classText(h), examName: h.terminal_name }, subjects, students);
}
