import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { adToBsText } from "../../core/dates";
import type { ApplicationDetail, ApplicationQueue, OpenLevelList, StudentDetail, StudentList } from "./schema";

const sectionFilter = (sections: "all" | readonly string[]): string | null => (sections === "all" ? null : JSON.stringify(sections));

interface OpenLevelRow {
  public_id: string;
  name: string;
  programme_id: string;
  programme_name: string;
  section_key: string;
  section_name: string;
}

/** Every open (active programme, active level) level, for the public application form's picker. No section filter: anyone applies to any section. */
export async function listOpenLevels(db: D1Database): Promise<OpenLevelList> {
  const { results } = await db
    .prepare(
      `SELECT lv.public_id, lv.name, pv.public_id AS programme_id, pv.name AS programme_name, s.key AS section_key, s.name AS section_name
         FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
        WHERE lv.is_active = 1 AND pv.is_active = 1
        ORDER BY s.ordering, pv.ordering, lv.ordinal`,
    )
    .all<OpenLevelRow>();
  return { levels: results.map((r) => ({ id: r.public_id, name: r.name, programmeId: r.programme_id, programmeName: r.programme_name, sectionKey: r.section_key, sectionName: r.section_name })) };
}

interface QueueRow {
  public_id: string;
  first_name: string;
  last_name: string;
  status: string;
  walk_in: number;
  level_id: string;
  level_name: string;
  programme_name: string;
  section_key: string;
  section_name: string;
  duplicate_flags: string | null;
  created_at: string;
}

const toSummary = (r: QueueRow) => ({
  id: r.public_id,
  firstName: r.first_name,
  lastName: r.last_name,
  status: r.status as ApplicationQueue["applications"][number]["status"],
  walkIn: r.walk_in === 1,
  levelId: r.level_id,
  levelName: r.level_name,
  programmeName: r.programme_name,
  sectionKey: r.section_key,
  sectionName: r.section_name,
  duplicateFlags: r.duplicate_flags ? (JSON.parse(r.duplicate_flags) as string[]) : [],
  createdAt: r.created_at,
});

/** The Co-ordinator's queue: applications waiting on a decision, oldest first. */
export async function listQueue(db: D1Database, sections: "all" | readonly string[]): Promise<ApplicationQueue> {
  const { results } = await db
    .prepare(
      `SELECT ap.public_id, ap.first_name, ap.last_name, ap.status, ap.walk_in, lv.public_id AS level_id, lv.name AS level_name, pv.name AS programme_name,
              s.key AS section_key, s.name AS section_name, ap.duplicate_flags, ap.created_at
         FROM applications ap JOIN levels lv ON lv.id = ap.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
        WHERE ap.status IN ('pending_review', 'needs_changes') AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
        ORDER BY ap.created_at`,
    )
    .bind(sectionFilter(sections))
    .all<QueueRow>();
  return { applications: results.map(toSummary) };
}

interface DetailRow extends QueueRow {
  middle_name: string | null;
  dob_ad: string;
  phone: string;
  email: string;
  guardian_name: string;
  guardian_phone: string;
  previous_school: string | null;
  referred_by: string | null;
  changes_requested: string | null;
  decision_reason: string | null;
}

/** One application, in full, for the review screen. Scoped to the viewer's sections. */
export async function getApplication(db: D1Database, sections: "all" | readonly string[], publicId: string): Promise<ApplicationDetail | null> {
  const row = await db
    .prepare(
      `SELECT ap.public_id, ap.first_name, ap.middle_name, ap.last_name, ap.status, ap.walk_in, ap.dob_ad, ap.phone, ap.email,
              ap.guardian_name, ap.guardian_phone, ap.previous_school, ap.referred_by, ap.changes_requested, ap.decision_reason,
              lv.public_id AS level_id, lv.name AS level_name, pv.name AS programme_name, s.key AS section_key, s.name AS section_name, ap.duplicate_flags, ap.created_at
         FROM applications ap JOIN levels lv ON lv.id = ap.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
        WHERE ap.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`,
    )
    .bind(publicId, sectionFilter(sections))
    .first<DetailRow>();
  if (!row) return null;
  return {
    ...toSummary(row),
    middleName: row.middle_name,
    dob: row.dob_ad,
    dobBs: adToBsText(row.dob_ad),
    phone: row.phone,
    email: row.email,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    previousSchool: row.previous_school,
    referredBy: row.referred_by,
    changesRequested: row.changes_requested ? (JSON.parse(row.changes_requested) as { fields: string[]; reason: string }) : null,
    decisionReason: row.decision_reason,
  };
}

interface StudentRow {
  public_id: string;
  sid: string;
  first_name: string;
  last_name: string;
  status: string;
  class_name: string | null;
}

/**
 * A student's most recent enrollment, by the start of its term (D-110: several terms can be open at once, so "the active
 * year" is no longer one row). For a SQL alias `st`.
 */
const LATEST_ENROLLMENT = `(SELECT e2.id FROM enrollments e2 JOIN academic_years y2 ON y2.id = e2.academic_year_id
                             WHERE e2.student_id = st.id ORDER BY y2.start_date DESC, e2.id DESC LIMIT 1)`;

/** By name, SID or phone, scoped to the viewer's sections through the student's most recent enrollment. */
export async function searchStudents(db: D1Database, sections: "all" | readonly string[], query: string): Promise<StudentList> {
  const like = `%${query.trim()}%`;
  const { results } = await db
    .prepare(
      `SELECT st.public_id, st.sid, st.first_name, st.last_name, st.status,
              pv.name || ' - ' || lv.name AS class_name
         FROM students st
         LEFT JOIN enrollments en ON en.id = ${LATEST_ENROLLMENT}
         LEFT JOIN classes cl ON cl.id = en.class_id
         LEFT JOIN levels lv ON lv.id = cl.level_id
         LEFT JOIN programmes pv ON pv.id = lv.programme_id
         LEFT JOIN sections s ON s.id = pv.section_id
        WHERE (st.first_name LIKE ?1 OR st.last_name LIKE ?1 OR st.sid LIKE ?1 OR st.phone LIKE ?1)
          AND (?2 IS NULL OR s.key IS NULL OR s.key IN (SELECT value FROM json_each(?2)))
        ORDER BY st.last_name, st.first_name
        LIMIT 50`,
    )
    .bind(like, sectionFilter(sections))
    .all<StudentRow>();
  return { students: results.map((r) => ({ id: r.public_id, sid: r.sid, firstName: r.first_name, lastName: r.last_name, status: r.status as StudentList["students"][number]["status"], className: r.class_name })) };
}

interface StudentDetailRow {
  public_id: string;
  sid: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  dob_ad: string;
  phone: string | null;
  email: string | null;
  guardian_name: string;
  guardian_phone: string;
  previous_school: string | null;
  status: string;
  class_name: string | null;
  created_at: string;
}

async function studentDetailFrom(db: D1Database, where: string, param: string): Promise<StudentDetail | null> {
  const row = await db
    .prepare(
      `SELECT st.public_id, st.sid, st.first_name, st.middle_name, st.last_name, st.dob_ad, st.phone, st.email,
              st.guardian_name, st.guardian_phone, st.previous_school, st.status, st.created_at,
              pv.name || ' - ' || lv.name AS class_name
         FROM students st
         LEFT JOIN enrollments en ON en.id = ${LATEST_ENROLLMENT}
         LEFT JOIN classes cl ON cl.id = en.class_id
         LEFT JOIN levels lv ON lv.id = cl.level_id
         LEFT JOIN programmes pv ON pv.id = lv.programme_id
        WHERE ${where}`,
    )
    .bind(param)
    .first<StudentDetailRow>();
  if (!row) return null;
  return {
    id: row.public_id,
    sid: row.sid,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    dob: row.dob_ad,
    dobBs: adToBsText(row.dob_ad),
    phone: row.phone,
    email: row.email,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    previousSchool: row.previous_school,
    status: row.status as StudentDetail["status"],
    className: row.class_name,
    createdAt: row.created_at,
  };
}

/** By public id, scoped to the viewer's sections (checked separately for a `own`-scope student, see the route). */
export async function getStudent(db: D1Database, sections: "all" | readonly string[], publicId: string): Promise<StudentDetail | null> {
  if (sections === "all") return studentDetailFrom(db, "st.public_id = ?1", publicId);
  const row = await db
    .prepare(
      `SELECT 1 FROM students st
         LEFT JOIN enrollments en ON en.id = ${LATEST_ENROLLMENT}
         LEFT JOIN classes cl ON cl.id = en.class_id LEFT JOIN levels lv ON lv.id = cl.level_id LEFT JOIN programmes pv ON pv.id = lv.programme_id LEFT JOIN sections s ON s.id = pv.section_id
        WHERE st.public_id = ?1 AND (s.key IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`,
    )
    .bind(publicId, JSON.stringify(sections))
    .first();
  if (!row) return null;
  return studentDetailFrom(db, "st.public_id = ?1", publicId);
}

/** The signed-in student's own record. */
export async function getOwnStudent(db: D1Database, userPublicId: string): Promise<StudentDetail | null> {
  return studentDetailFrom(db, "st.user_id = (SELECT id FROM users WHERE public_id = ?1)", userPublicId);
}

/**
 * The dashboard's students figure (D-088): active students of the active year now, and how many of them were already
 * enrolled at `since` (the start of the comparison window), so the change is "vs last month".
 */
export function studentsDashboardPart(db: D1Database, since: string): DashboardPart<{ total: number; previous: number }> {
  return {
    statements: [
      db
        .prepare(
          `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN en.created_at < ?1 THEN 1 ELSE 0 END), 0) AS previous
             FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id
            WHERE ay.status = 'active' AND en.status = 'active'`,
        )
        .bind(since),
    ],
    read: ([r]) => rowsOf<{ total: number; previous: number }>(r)[0] ?? { total: 0, previous: 0 },
  };
}
