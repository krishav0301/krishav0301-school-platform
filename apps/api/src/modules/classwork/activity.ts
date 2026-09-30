import { recordAudit } from "../../core/audit";
import { adToBsText, nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { CLASS_JOINS, TEACHES_SUBJECT, bindReach, classInReach, type Reach } from "./guard";
import { WriteActivitySchema, type ActivityClassList, type ClassActivityDay, type MissingActivity, type MyActivityToday, type OwnActivity, type WriteActivity } from "./schema";

/**
 * The daily activity log (D-071): one entry per class, subject and Nepal day, by the subject's teacher, editable the
 * same day. Students read their own class's; the Co-ordinator sees what is missing today.
 */

const naming = (r: { programme_name: string; level_name: string; label: string }) => ({ programmeName: r.programme_name, levelName: r.level_name, label: r.label });
const NAMING_COLUMNS = `pv.name AS programme_name, lv.name AS level_name, cl.label`;

/** How many recent days a student sees. */
export const OWN_DAYS = 14;

/** The subjects the teacher teaches this year, each with today's entry or none. */
export async function myToday(db: D1Database, me: string, today: string): Promise<MyActivityToday> {
  const { results } = await db
    .prepare(
      `SELECT cl.public_id AS class_id, o.public_id AS offering_id, sb.name AS subject_name, ${NAMING_COLUMNS}, al.body
         FROM teacher_assignments ta
         JOIN users u ON u.id = ta.teacher_user_id
         JOIN classes cl ON cl.id = ta.class_id ${CLASS_JOINS}
         JOIN academic_years ay ON ay.id = cl.academic_year_id
         JOIN subject_offerings o ON o.id = ta.offering_id JOIN subjects sb ON sb.id = o.subject_id
         LEFT JOIN activity_log al ON al.class_id = cl.id AND al.offering_id = o.id AND al.on_date = ?2
        WHERE u.public_id = ?1 AND u.is_active = 1 AND ta.is_active = 1 AND ay.status = 'active'
        ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, sb.name`,
    )
    .bind(me, today)
    .all<{ class_id: string; offering_id: string; subject_name: string; programme_name: string; level_name: string; label: string; body: string | null }>();
  return {
    date: today,
    dateBs: adToBsText(today),
    subjects: results.map((r) => ({ classId: r.class_id, offeringId: r.offering_id, subjectName: r.subject_name, ...naming(r), body: r.body })),
  };
}

export type ActivityRead<T> = { ok: true; data: T } | { ok: false; reason: "not_found" };

/**
 * One class's day: every subject taught at its level, the entry or none, and who teaches it. A teacher who reaches the
 * class only through their own assignments sees only their own subjects' entries.
 */
export async function classDay(db: D1Database, reach: Reach, onlyOwnSubjects: boolean, classId: string, date: string): Promise<ActivityRead<ClassActivityDay>> {
  const [cls, rows] = await db.batch([
    db.prepare(`SELECT cl.public_id, ${NAMING_COLUMNS} FROM classes cl ${CLASS_JOINS} WHERE cl.public_id = ?5 AND ${classInReach(1)}`).bind(...bindReach(reach), classId),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, sb.name AS subject_name, al.body, al.updated_at,
                COALESCE(wu.full_name, (SELECT tu.full_name FROM teacher_assignments ta JOIN users tu ON tu.id = ta.teacher_user_id WHERE ta.class_id = cl.id AND ta.offering_id = o.id AND ta.is_active = 1)) AS teacher_name
           FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
           LEFT JOIN activity_log al ON al.class_id = cl.id AND al.offering_id = o.id AND al.on_date = ?2
           LEFT JOIN users wu ON wu.id = al.teacher_user_id
          WHERE cl.public_id = ?1
            AND (?4 = 0 OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN users au ON au.id = ta.teacher_user_id
                                    WHERE ta.class_id = cl.id AND ta.offering_id = o.id AND ta.is_active = 1 AND au.public_id = ?3))
          ORDER BY sb.name`,
      )
      .bind(classId, date, reach.me, onlyOwnSubjects ? 1 : 0),
  ]);
  const row = cls!.results[0] as { public_id: string; programme_name: string; level_name: string; label: string } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const entries = (rows!.results as unknown as { offering_id: string; subject_name: string; body: string | null; updated_at: string | null; teacher_name: string | null }[]).map((r) => ({
    offeringId: r.offering_id,
    subjectName: r.subject_name,
    teacherName: r.teacher_name,
    body: r.body,
    updatedAt: r.updated_at,
  }));
  return { ok: true, data: { classId: row.public_id, ...naming(row), date, dateBs: adToBsText(date), entries } };
}

/** The student's own class, the last `OWN_DAYS` days that have entries, newest first. Found from the sign-in, never from an id. */
export async function ownActivity(db: D1Database, me: string, today: string): Promise<OwnActivity> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - (OWN_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT al.on_date, sb.name AS subject_name, wu.full_name AS teacher_name, al.body
         FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
         JOIN activity_log al ON al.class_id = en.class_id
         JOIN subject_offerings o ON o.id = al.offering_id JOIN subjects sb ON sb.id = o.subject_id
         JOIN users wu ON wu.id = al.teacher_user_id
        WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND ay.status = 'active' AND en.status = 'active' AND al.on_date >= ?2
        ORDER BY al.on_date DESC, sb.name`,
    )
    .bind(me, since)
    .all<{ on_date: string; subject_name: string; teacher_name: string; body: string }>();
  const days: OwnActivity["days"] = [];
  for (const r of results) {
    let day = days[days.length - 1];
    if (!day || day.date !== r.on_date) days.push((day = { date: r.on_date, dateBs: adToBsText(r.on_date), entries: [] }));
    day.entries.push({ subjectName: r.subject_name, teacherName: r.teacher_name, body: r.body });
  }
  return { days };
}

/** Today's reminder: each class in reach with the subjects that have a teacher but no entry yet. */
export async function missingToday(db: D1Database, reach: Reach, today: string): Promise<MissingActivity> {
  const { results } = await db
    .prepare(
      `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, sb.name AS subject_name, tu.full_name AS teacher_name
         FROM teacher_assignments ta
         JOIN classes cl ON cl.id = ta.class_id ${CLASS_JOINS}
         JOIN academic_years ay ON ay.id = cl.academic_year_id
         JOIN subject_offerings o ON o.id = ta.offering_id JOIN subjects sb ON sb.id = o.subject_id
         JOIN users tu ON tu.id = ta.teacher_user_id
         LEFT JOIN activity_log al ON al.class_id = cl.id AND al.offering_id = o.id AND al.on_date = ?5
        WHERE ta.is_active = 1 AND ay.status = 'active' AND cl.is_active = 1 AND al.id IS NULL AND ${classInReach(1)}
        ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, sb.name`,
    )
    .bind(...bindReach(reach), today)
    .all<{ class_id: string; programme_name: string; level_name: string; label: string; subject_name: string; teacher_name: string }>();
  const classes: MissingActivity["classes"] = [];
  for (const r of results) {
    let entry = classes[classes.length - 1];
    if (!entry || entry.classId !== r.class_id) classes.push((entry = { classId: r.class_id, ...naming(r), missing: [] }));
    entry.missing.push({ subjectName: r.subject_name, teacherName: r.teacher_name });
  }
  return { date: today, dateBs: adToBsText(today), classes };
}

export type WriteResult = { ok: true } | { ok: false; reason: "not_found" | "year_closed" } | { ok: false; reason: "invalid"; message: string };

/** The teacher still holds this subject in this class, and is an active teacher. */
const MAY_WRITE = TEACHES_SUBJECT;

/** Writes (or rewrites, the same day) today's entry. One batch: the entry and its audit record. */
export async function writeToday(db: D1Database, auditKey: string, me: string, classId: string, offeringId: string, input: WriteActivity, now = new Date()): Promise<WriteResult> {
  const parsed = WriteActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const today = nepalDate(now);

  const check = await db
    .prepare(`SELECT ay.status FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u WHERE ${MAY_WRITE}`)
    .bind(me, classId, offeringId)
    .first<{ status: string }>();
  if (!check) return { ok: false, reason: "not_found" };
  if (check.status === "closed") return { ok: false, reason: "year_closed" };
  if (check.status !== "active") return { ok: false, reason: "not_found" };

  const at = now.toISOString();
  const upsert = db
    .prepare(
      `INSERT INTO activity_log (public_id, class_id, offering_id, on_date, teacher_user_id, body, created_at, updated_at)
       SELECT ?4, cl.id, o.id, ?5, u.id, ?6, ?7, ?7
         FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u
        WHERE ${MAY_WRITE} AND ay.status = 'active'
       ON CONFLICT (class_id, offering_id, on_date) DO UPDATE SET body = excluded.body, teacher_user_id = excluded.teacher_user_id, updated_at = excluded.updated_at`,
    )
    .bind(me, classId, offeringId, newPublicId(), today, parsed.data.body, at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "activity.written", entityType: "class", entityPublicId: classId, actorPublicId: me, summary: `Activity log for ${today}`, after: { date: today, offeringId } },
      [upsert],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    throw error;
  }
}

/** The active year's classes in reach, each with how many taught subjects have today's entry. */
export async function listClasses(db: D1Database, reach: Reach, today: string): Promise<ActivityClassList> {
  const { results } = await db
    .prepare(
      `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS},
              (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.class_id = cl.id AND ta.is_active = 1) AS expected,
              (SELECT COUNT(*) FROM activity_log al WHERE al.class_id = cl.id AND al.on_date = ?5) AS written
         FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
        WHERE ay.status = 'active' AND cl.is_active = 1 AND ${classInReach(1)}
        ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label`,
    )
    .bind(...bindReach(reach), today)
    .all<{ class_id: string; programme_name: string; level_name: string; label: string; expected: number; written: number }>();
  return { date: today, dateBs: adToBsText(today), classes: results.map((r) => ({ classId: r.class_id, ...naming(r), expected: r.expected, written: r.written })) };
}
