import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { CLASS_JOINS, TEACHES_SUBJECT, teachesRow } from "./guard";
import { ShareNoteSchema, type ShareNote, type StudentNotes, type TeacherNotes } from "./schema";

/**
 * Notes and question papers (D-072): shared by the subject's teacher, live at once, replaced by withdrawing and
 * sharing again. Text and an optional https link while R2 is off (D-020). Students of the class read them with a
 * watermark of their own name and SID; that is a deterrent, never a guarantee (source 6.1).
 */

export const notesOn = `COALESCE((SELECT enabled FROM module_switches WHERE key = 'notes'), 1) = 1`;

export type NotesWrite = { ok: true; publicId: string } | { ok: false; reason: "off" | "not_found" | "year_closed" } | { ok: false; reason: "invalid"; message: string };

const TEACHES = TEACHES_SUBJECT;

export async function shareNote(db: D1Database, auditKey: string, me: string, input: ShareNote, now = new Date()): Promise<NotesWrite> {
  const parsed = ShareNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const { classId, offeringId, kind, title } = parsed.data;
  const body = parsed.data.body ? parsed.data.body : null;
  const link = parsed.data.link ? parsed.data.link : null;
  if (body === null && link === null) return { ok: false, reason: "invalid", message: "Write the note, or give a link to it" };

  const check = await db
    .prepare(`SELECT (${notesOn}) AS on_, ay.status FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u WHERE ${TEACHES}`)
    .bind(me, classId, offeringId)
    .first<{ on_: number; status: string }>();
  if (!check || check.on_ !== 1) return { ok: false, reason: check ? "off" : "not_found" };
  if (check.status === "closed") return { ok: false, reason: "year_closed" };
  if (check.status !== "active") return { ok: false, reason: "not_found" };

  const publicId = newPublicId();
  const insert = db
    .prepare(
      `INSERT INTO class_notes (public_id, class_id, offering_id, kind, title, body, link, teacher_user_id, created_at)
       SELECT ?4, cl.id, o.id, ?5, ?6, ?7, ?8, u.id, ?9
         FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u
        WHERE ${TEACHES} AND ay.status = 'active' AND ${notesOn}`,
    )
    .bind(me, classId, offeringId, publicId, kind, title, body, link, now.toISOString());
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "notes.shared", entityType: "class_note", entityPublicId: publicId, actorPublicId: me, summary: `${kind === "note" ? "Note" : "Question paper"} shared: ${title}`, after: { classId, offeringId, kind, title } },
      [insert],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true, publicId } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (/academic year is closed/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "year_closed" };
    throw error;
  }
}

/** Withdraws a live note, once. Only a teacher who still teaches that subject in that class may. */
export async function withdrawNote(db: D1Database, auditKey: string, me: string, notePublicId: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: "not_found" | "year_closed" }> {
  const update = db
    .prepare(
      `UPDATE class_notes SET withdrawn_at = ?3, withdrawn_by_user_id = (SELECT id FROM users WHERE public_id = ?1)
        WHERE public_id = ?2 AND withdrawn_at IS NULL AND ${notesOn}
          AND ${teachesRow(1, "class_notes")}`,
    )
    .bind(me, notePublicId, now.toISOString());
  try {
    const { applied } = await recordAudit(db, auditKey, { action: "notes.withdrawn", entityType: "class_note", entityPublicId: notePublicId, actorPublicId: me, summary: "Note withdrawn" }, [update], { onlyIfLastChanged: true });
    return applied ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (/academic year is closed/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "year_closed" };
    throw error;
  }
}

interface NoteRow {
  public_id: string;
  kind: "note" | "question_paper";
  title: string;
  body: string | null;
  link: string | null;
  subject_name: string;
  created_at: string;
}
const noteOf = (r: NoteRow) => ({ id: r.public_id, kind: r.kind, title: r.title, body: r.body, link: r.link, subjectName: r.subject_name, createdAt: r.created_at });

export type NotesRead<T> = { ok: true; data: T } | { ok: false; reason: "off" };

/** Everything the teacher has shared in subjects they teach this year, newest first, withdrawn ones marked. */
export async function teacherNotes(db: D1Database, me: string): Promise<NotesRead<TeacherNotes>> {
  const [on, rows] = await db.batch([
    db.prepare(`SELECT (${notesOn}) AS on_`),
    db
      .prepare(
        `SELECT n.public_id, n.kind, n.title, n.body, n.link, sb.name AS subject_name, n.created_at, n.withdrawn_at,
                cl.public_id AS class_id, pv.name AS programme_name, lv.name AS level_name, cl.label
           FROM class_notes n JOIN classes cl ON cl.id = n.class_id ${CLASS_JOINS}
           JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN subject_offerings o ON o.id = n.offering_id JOIN subjects sb ON sb.id = o.subject_id
          WHERE ay.status = 'active'
            AND EXISTS (SELECT 1 FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_user_id
                         WHERE u.public_id = ?1 AND ta.is_active = 1 AND ta.class_id = n.class_id AND ta.offering_id = n.offering_id)
          ORDER BY n.created_at DESC
          LIMIT 200`,
      )
      .bind(me),
  ]);
  if ((on!.results[0] as { on_: number }).on_ !== 1) return { ok: false, reason: "off" };
  const notes = (rows!.results as unknown as (NoteRow & { withdrawn_at: string | null; class_id: string; programme_name: string; level_name: string; label: string })[]).map((r) => ({
    ...noteOf(r),
    classId: r.class_id,
    programmeName: r.programme_name,
    levelName: r.level_name,
    label: r.label,
    withdrawn: r.withdrawn_at !== null,
  }));
  return { ok: true, data: { notes } };
}

/** The student's own class's live notes, newest first, and the watermark to draw across them. Found from the sign-in. */
export async function studentNotes(db: D1Database, me: string): Promise<NotesRead<StudentNotes>> {
  const mine = `SELECT en.class_id FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
                 WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND ay.status = 'active' AND en.status = 'active'`;
  const [on, who, rows] = await db.batch([
    db.prepare(`SELECT (${notesOn}) AS on_`),
    db.prepare(`SELECT first_name, last_name, sid FROM students WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)`).bind(me),
    db
      .prepare(
        `SELECT n.public_id, n.kind, n.title, n.body, n.link, sb.name AS subject_name, n.created_at, tu.full_name AS teacher_name
           FROM class_notes n JOIN subject_offerings o ON o.id = n.offering_id JOIN subjects sb ON sb.id = o.subject_id JOIN users tu ON tu.id = n.teacher_user_id
          WHERE n.class_id IN (${mine}) AND n.withdrawn_at IS NULL
          ORDER BY n.created_at DESC
          LIMIT 200`,
      )
      .bind(me),
  ]);
  if ((on!.results[0] as { on_: number }).on_ !== 1) return { ok: false, reason: "off" };
  const student = who!.results[0] as { first_name: string; last_name: string; sid: string } | undefined;
  const watermark = student ? `${student.first_name} ${student.last_name} · ${student.sid}` : "";
  const notes = (rows!.results as unknown as (NoteRow & { teacher_name: string })[]).map((r) => ({ ...noteOf(r), teacherName: r.teacher_name }));
  return { ok: true, data: { watermark, notes } };
}
