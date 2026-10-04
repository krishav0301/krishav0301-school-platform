import { recordAudit } from "../../core/audit";
import { adToBsText, bsToAd, bsToText, daysInMonth, nepalDate, UnverifiedCalendarYearError, weekday } from "../../core/dates";
import type { Grant } from "../../core/permissions";
import { moduleOn } from "./guard";
import { SaveTeacherDaySchema, type OwnTeacherMonth, type SaveTeacherDay, type TeacherDay } from "./schema";

/**
 * Teacher attendance (D-070): the Co-ordinator's daily list, pre-filled Present, with Absent and On leave as the
 * exceptions; any day but today needs a reason. The teacher reads their own month.
 *
 * Who is "in reach": active users with an active teacher role, narrowed for a section-scoped Co-ordinator to the
 * teachers whose home section is theirs (the same rule as who may manage a teacher, D-059). A teacher with no home
 * section is reached by an institution-wide Co-ordinator only.
 */

type Status = "present" | "absent" | "leave";

/**
 * The teachers (`tu`, home section `ts`), read from their teacher role rows (`tr`) through the role index rather than
 * from every login in the school, students included (D-108). A teacher has one teacher role row.
 */
const TEACHERS = `role_assignments tr JOIN users tu ON tu.id = tr.user_id LEFT JOIN staff_profiles tp ON tp.user_id = tu.id LEFT JOIN sections ts ON ts.id = tp.home_section_id`;
const ACTIVE_TEACHER = `tr.role = 'teacher' AND tr.is_active = 1 AND tu.is_active = 1`;

/** From the token's grant (reads only): institution, or the listed sections. */
const GRANT_REACH = `(?2 = 1 OR ts.key IN (SELECT value FROM json_each(COALESCE(?3, '[]'))))`;

/**
 * From the database (writes): the actor `mu` is still an active Co-ordinator whose assignment covers the teacher's
 * home section, or an active Super Admin. Re-checked inside the write itself (D-021), never taken from the token.
 */
const ACTOR_REACH = `mu.is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ma WHERE ma.user_id = mu.id AND ma.is_active = 1
                       AND (ma.role = 'super_admin' OR (ma.role = 'coordinator' AND (ma.scope_type = 'institution' OR ma.section_id = tp.home_section_id))))`;

export type TeacherRead<T> = { ok: true; data: T } | { ok: false; reason: "off" | "not_found" };

interface TeacherRow {
  public_id: string;
  full_name: string;
  section_key: string | null;
  status: Status | null;
  reason: string | null;
}

/** The daily list for a day: every teacher in the grant's reach, and their mark or none. */
export async function getTeacherDay(db: D1Database, grant: Grant, date: string, today: string): Promise<TeacherRead<TeacherDay>> {
  const [on, rows] = await db.batch([
    db.prepare(`SELECT (${moduleOn("teacher_attendance")}) AS on_`),
    db
      .prepare(
        `SELECT tu.public_id, tu.full_name, ts.key AS section_key, ta.status, ta.reason
           FROM ${TEACHERS}
           LEFT JOIN teacher_attendance ta ON ta.user_id = tu.id AND ta.on_date = ?1
          WHERE ${ACTIVE_TEACHER} AND ${GRANT_REACH}
          ORDER BY tu.full_name, tu.id`,
      )
      .bind(date, grant.institution ? 1 : 0, grant.sections.length > 0 ? JSON.stringify(grant.sections) : null),
  ]);
  if ((on!.results[0] as { on_: number }).on_ !== 1) return { ok: false, reason: "off" };
  const teachers = (rows!.results as unknown as TeacherRow[]).map((r) => ({ id: r.public_id, name: r.full_name, sectionKey: r.section_key, status: r.status, reason: r.reason }));
  return { ok: true, data: { date, dateBs: adToBsText(date), isToday: date === today, marked: teachers.some((t) => t.status !== null), teachers } };
}

export type SaveTeacherResult =
  | { ok: true; present: number; absent: number; leave: number }
  | { ok: false; reason: "not_found" | "year_closed" }
  | { ok: false; reason: "invalid"; message: string };

const invalid = (message: string): SaveTeacherResult => ({ ok: false, reason: "invalid", message });

/**
 * Saves a day. Everyone in the actor's reach not listed as an exception is Present. One batch: every teacher's row
 * and the audit entry, which carries the day before and after, and the reason. Saving the same day again replaces it.
 */
export async function saveTeacherDay(db: D1Database, auditKey: string, actor: string, input: SaveTeacherDay, now = new Date()): Promise<SaveTeacherResult> {
  const parsed = SaveTeacherDaySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "That is not valid");
  const { date, exceptions } = parsed.data;
  const reason = parsed.data.reason ? parsed.data.reason : null;
  const today = nepalDate(now);

  if (adToBsText(date) === null) return invalid("That day is outside the verified calendar");
  if (date > today) return invalid("A future day cannot be marked");
  if (date < today && (reason === null || reason.length < 3)) return invalid("Give a reason for changing a past day");

  // One read: is the module on and the actor allowed, which teachers do they reach and how is each marked now,
  // and does the day fall in a closed year?
  const [state, reach, closed] = await db.batch([
    db
      .prepare(
        `SELECT (${moduleOn("teacher_attendance")}) AS on_,
                EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
                         WHERE mu.public_id = ?1 AND mu.is_active = 1 AND ma.is_active = 1 AND ma.role IN ('coordinator', 'super_admin')) AS allowed`,
      )
      .bind(actor),
    db
      .prepare(
        `SELECT tu.public_id, ta.status
           FROM ${TEACHERS} LEFT JOIN teacher_attendance ta ON ta.user_id = tu.id AND ta.on_date = ?2, users mu
          WHERE mu.public_id = ?1 AND ${ACTIVE_TEACHER} AND ${ACTOR_REACH}`,
      )
      .bind(actor, date),
    db.prepare(`SELECT EXISTS (SELECT 1 FROM academic_years WHERE status = 'closed' AND ?1 BETWEEN start_date AND end_date) AS closed`).bind(date),
  ]);
  const flags = state!.results[0] as { on_: number; allowed: number };
  if (flags.on_ !== 1 || flags.allowed !== 1) return { ok: false, reason: "not_found" };
  if ((closed!.results[0] as { closed: number }).closed === 1) return { ok: false, reason: "year_closed" };

  const current = reach!.results as unknown as { public_id: string; status: Status | null }[];
  const inReach = new Set(current.map((r) => r.public_id));
  if (exceptions.some((e) => !inReach.has(e.teacherId))) return invalid("A teacher listed is not one you mark");
  if (current.length === 0) return { ok: true, present: 0, absent: 0, leave: 0 };

  const listOf = (rows: { id: string; status: Status | null }[], status: Status) => rows.filter((r) => r.status === status).map((r) => r.id).sort();
  const before = current.map((r) => ({ id: r.public_id, status: r.status }));
  const exceptionOf = new Map(exceptions.map((e) => [e.teacherId, e.status]));
  const after = current.map((r) => ({ id: r.public_id, status: (exceptionOf.get(r.public_id) ?? "present") as Status }));

  const at = now.toISOString();
  const upsert = db
    .prepare(
      `INSERT INTO teacher_attendance (user_id, on_date, status, reason, marked_by_user_id, marked_at, updated_at)
       SELECT tu.id, ?2,
              COALESCE((SELECT json_extract(value, '$.status') FROM json_each(?3) WHERE json_extract(value, '$.teacherId') = tu.public_id), 'present'),
              ?4, mu.id, ?5, ?5
         FROM ${TEACHERS}, users mu
        WHERE mu.public_id = ?1 AND ${ACTIVE_TEACHER} AND ${ACTOR_REACH} AND ${moduleOn("teacher_attendance")}
       ON CONFLICT (user_id, on_date) DO UPDATE SET status = excluded.status, reason = excluded.reason, marked_by_user_id = excluded.marked_by_user_id, updated_at = excluded.updated_at`,
    )
    .bind(actor, date, JSON.stringify(exceptions), reason, at);

  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "attendance.teacher.marked",
        entityType: "teacher_attendance_day",
        entityPublicId: date,
        actorPublicId: actor,
        summary: `Teacher attendance for ${date}: ${exceptions.length} exception(s) of ${current.length}`,
        before: { date, marked: before.some((r) => r.status !== null), absent: listOf(before, "absent"), leave: listOf(before, "leave") },
        after: { date, absent: listOf(after, "absent"), leave: listOf(after, "leave") },
        reason,
      },
      [upsert],
      { onlyIfLastChanged: true },
    );
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    if (/past day needs a reason|future day/i.test(message)) return invalid("A past day needs a reason, and a future day cannot be marked");
    throw error;
  }
  const leave = exceptions.filter((e) => e.status === "leave").length;
  const absent = exceptions.length - leave;
  return { ok: true, present: current.length - exceptions.length, absent, leave };
}

/** The teacher's own BS month, every day of it, with their marks. Refuses a year outside the verified calendar. */
export async function getOwnMonth(db: D1Database, userPublicId: string, month: string): Promise<TeacherRead<OwnTeacherMonth> | { ok: false; reason: "unverified" }> {
  const [year, m] = month.split("-").map(Number) as [number, number];
  let days: { date: string; dateBs: string; weekday: number }[];
  try {
    days = Array.from({ length: daysInMonth(year, m) }, (_, i) => {
      const bs = { year, month: m, day: i + 1 };
      return { date: bsToAd(bs), dateBs: bsToText(bs), weekday: weekday(bs) };
    });
  } catch (error) {
    if (error instanceof UnverifiedCalendarYearError) return { ok: false, reason: "unverified" };
    throw error;
  }
  const [on, rows] = await db.batch([
    db.prepare(`SELECT (${moduleOn("teacher_attendance")}) AS on_`),
    db
      .prepare(`SELECT on_date, status FROM teacher_attendance WHERE user_id = (SELECT id FROM users WHERE public_id = ?1) AND on_date BETWEEN ?2 AND ?3`)
      .bind(userPublicId, days[0]!.date, days[days.length - 1]!.date),
  ]);
  if ((on!.results[0] as { on_: number }).on_ !== 1) return { ok: false, reason: "off" };
  const byDate = new Map((rows!.results as unknown as { on_date: string; status: Status }[]).map((r) => [r.on_date, r.status]));
  const withStatus = days.map((d) => ({ ...d, status: byDate.get(d.date) ?? null }));
  const count = (s: Status) => withStatus.filter((d) => d.status === s).length;
  return { ok: true, data: { month, present: count("present"), absent: count("absent"), leave: count("leave"), days: withStatus } };
}
