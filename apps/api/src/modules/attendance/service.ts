import { recordAudit } from "../../core/audit";
import { nepalDate } from "../../core/dates";
import { activeTeacher, moduleOn } from "./guard";
import { MarkTodaySchema, type MarkToday } from "./schema";

export type MarkResult =
  | { ok: true; present: number; absent: number }
  | { ok: false; reason: "not_found" | "year_closed" }
  | { ok: false; reason: "invalid"; message: string };

/** The class may be marked by this person today: they are its Class Teacher, still an active teacher, the module is on. */
const MAY_MARK = `u.public_id = ?1 AND cl.public_id = ?2 AND cl.class_teacher_user_id = u.id AND ${activeTeacher("u")} AND ${moduleOn("attendance")}`;

/**
 * The Class Teacher's register for today (Nepal's date). Everyone not named absent is Present. Repeating it the
 * same day replaces the day, so a retry after a lost answer changes nothing new. One batch: every student's row
 * and the one audit entry, all or nothing. The Class Teacher is re-checked inside that batch (D-021).
 */
export async function markToday(db: D1Database, auditKey: string, actor: string, classId: string, input: MarkToday, now = new Date()): Promise<MarkResult> {
  const parsed = MarkTodaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const absent = JSON.stringify(parsed.data.absent);
  const today = nepalDate(now);

  // One read: may they, is the year open, how many are enrolled, and are all the absent students in this class?
  const check = await db
    .prepare(
      `SELECT ay.status AS year_status,
              (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active') AS enrolled,
              (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active' AND en.public_id IN (SELECT value FROM json_each(?3))) AS named
         FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, users u
        WHERE ${MAY_MARK}`,
    )
    .bind(actor, classId, absent)
    .first<{ year_status: string; enrolled: number; named: number }>();
  if (!check) return { ok: false, reason: "not_found" };
  if (check.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (check.year_status !== "active") return { ok: false, reason: "not_found" };
  if (check.named !== parsed.data.absent.length) return { ok: false, reason: "invalid", message: "A student listed is not in this class" };
  if (check.enrolled === 0) return { ok: true, present: 0, absent: 0 };

  const at = now.toISOString();
  const upsert = db
    .prepare(
      `INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at)
       SELECT en.id, ?4, CASE WHEN en.public_id IN (SELECT value FROM json_each(?3)) THEN 'absent' ELSE 'present' END, u.id, ?5, ?5
         FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN enrollments en ON en.class_id = cl.id, users u
        WHERE ${MAY_MARK} AND ay.status = 'active' AND en.status = 'active'
       ON CONFLICT (enrollment_id, on_date) DO UPDATE SET status = excluded.status, marked_by_user_id = excluded.marked_by_user_id, updated_at = excluded.updated_at`,
    )
    .bind(actor, classId, absent, today, at);

  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "attendance.student.marked",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: actor,
        summary: `Attendance marked for ${today}: ${parsed.data.absent.length} absent of ${check.enrolled}`,
        after: { date: today, absent: parsed.data.absent },
      },
      [upsert],
      { onlyIfLastChanged: true },
    );
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    throw error;
  }
  return { ok: true, present: check.enrolled - parsed.data.absent.length, absent: parsed.data.absent.length };
}
