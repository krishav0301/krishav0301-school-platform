/**
 * The Students page (PM, 2026-10-06): every student the viewer may see, narrowed by wing, course, level and class, a
 * search, a status and a term, paged in the database; with the counts, the wing-to-class lists and the terms, in one
 * round trip.
 *
 * Which enrollment a student is shown with: with no term asked for, their most recent one, and only if its term is open
 * (not closed: a draft term is open too, as on the class page)
 * (a student with no enrollment at all is listed too, in no class); with a term, their enrollment in that term, and only
 * students who have one. The wing-to-class lists are built from the same rows before the wing, course, level, class and
 * search filters, so they offer only what has students. Scope follows the existing search: the section of the class the
 * student is shown in; a student in no class is visible to every viewer allowed here.
 */
import type { StudentBrowse, StudentBrowseQuery } from "./schema";

export const STUDENT_PAGE_SIZE = 10;

/** "%text%" for LIKE, with the wildcards in the text itself made literal (escape character "\"). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** A student's most recent enrollment, by the start of its term. For a SQL alias `st`. */
const LATEST = `(SELECT e2.id FROM enrollments e2 JOIN academic_years y2 ON y2.id = e2.academic_year_id
                  WHERE e2.student_id = st.id ORDER BY y2.start_date DESC, e2.id DESC LIMIT 1)`;

/** The class, level, course, wing and term of the enrollment `en`. */
const PLACE = `LEFT JOIN academic_years y ON y.id = en.academic_year_id
               LEFT JOIN classes cl ON cl.id = en.class_id
               LEFT JOIN levels lv ON lv.id = cl.level_id
               LEFT JOIN programmes pv ON pv.id = lv.programme_id
               LEFT JOIN sections s ON s.id = pv.section_id`;

/** ?3: the viewer's sections as JSON, or null for the whole school. */
const IN_SCOPE = `(?3 IS NULL OR s.key IS NULL OR s.key IN (SELECT value FROM json_each(?3)))`;

/** The rows before the wing-to-class and search filters. ?1 the term's public id (null: the open terms), ?2 the student status (null: all). */
const BASE = `FROM students st
  LEFT JOIN enrollments en ON en.id = CASE WHEN ?1 IS NULL THEN ${LATEST}
       ELSE (SELECT e3.id FROM enrollments e3 JOIN academic_years y3 ON y3.id = e3.academic_year_id WHERE e3.student_id = st.id AND y3.public_id = ?1) END
  ${PLACE}
 WHERE ((?1 IS NULL AND (en.id IS NULL OR y.status <> 'closed')) OR (?1 IS NOT NULL AND en.id IS NOT NULL))
   AND (?2 IS NULL OR st.status = ?2)
   AND ${IN_SCOPE}`;

/** ?4 wing key, ?5 course, ?6 level, ?7 class (public ids), ?8 the search as a LIKE pattern. */
const FILTERED = `${BASE}
   AND (?4 IS NULL OR s.key = ?4)
   AND (?5 IS NULL OR pv.public_id = ?5)
   AND (?6 IS NULL OR lv.public_id = ?6)
   AND (?7 IS NULL OR cl.public_id = ?7)
   AND (?8 IS NULL OR st.first_name LIKE ?8 ESCAPE '\\' OR st.last_name LIKE ?8 ESCAPE '\\'
        OR (st.first_name || ' ' || st.last_name) LIKE ?8 ESCAPE '\\'
        OR st.sid LIKE ?8 ESCAPE '\\' OR st.phone LIKE ?8 ESCAPE '\\' OR st.guardian_phone LIKE ?8 ESCAPE '\\')`;

/** Wings, courses, levels and classes in the school's order. */
const PLACE_ORDER = "s.ordering, s.name COLLATE NOCASE, pv.ordering, pv.name COLLATE NOCASE, lv.ordinal, cl.label COLLATE NOCASE";

interface Row {
  public_id: string;
  sid: string;
  first_name: string;
  last_name: string;
  status: "active" | "left" | "graduated";
  guardian_phone: string;
  roll_no: number | null;
  class_id: string | null;
  class_label: string | null;
  level_name: string | null;
  course_name: string | null;
  wing_name: string | null;
  term_id: string | null;
  term_label: string | null;
}

interface PlaceRow {
  wing_key: string;
  wing_name: string;
  course_id: string;
  course_name: string;
  level_id: string;
  level_name: string;
  class_id: string;
  class_label: string;
  n: number;
}

export async function browseStudents(db: D1Database, sections: "all" | readonly string[], query: StudentBrowseQuery): Promise<StudentBrowse> {
  const pageSize = query.pageSize ?? STUDENT_PAGE_SIZE;
  const page = query.page ?? 1;
  const status = !query.status ? "active" : query.status === "all" ? null : query.status;
  const scope = sections === "all" ? null : JSON.stringify(sections);
  const base = [query.term ?? null, status, scope] as const;
  const filters = [...base, query.wing ?? null, query.course ?? null, query.level ?? null, query.class ?? null, query.q ? likePattern(query.q) : null] as const;

  const [list, total, places, counts, terms] = await db.batch([
    db
      .prepare(
        `SELECT st.public_id, st.sid, st.first_name, st.last_name, st.status, st.guardian_phone, en.roll_no,
                cl.public_id AS class_id, cl.label AS class_label, lv.name AS level_name, pv.name AS course_name, s.name AS wing_name,
                y.public_id AS term_id, y.label AS term_label
         ${FILTERED}
         ORDER BY (cl.id IS NULL), ${PLACE_ORDER}, (en.roll_no IS NULL), en.roll_no,
                  st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE, st.id
         LIMIT ?9 OFFSET ?10`,
      )
      .bind(...filters, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS n ${FILTERED}`).bind(...filters),
    db
      .prepare(
        `SELECT s.key AS wing_key, s.name AS wing_name, pv.public_id AS course_id, pv.name AS course_name,
                lv.public_id AS level_id, lv.name AS level_name, cl.public_id AS class_id, cl.label AS class_label, COUNT(*) AS n
         ${BASE} AND cl.id IS NOT NULL
         GROUP BY cl.id
         ORDER BY ${PLACE_ORDER}`,
      )
      .bind(...base),
    db
      .prepare(
        `SELECT COALESCE(SUM(st.status = 'active'), 0) AS active,
                COALESCE(SUM(st.status = 'active' AND y.status <> 'closed'), 0) AS in_open,
                COALESCE(SUM(st.status IN ('left', 'graduated')), 0) AS gone
           FROM students st
           LEFT JOIN enrollments en ON en.id = ${LATEST}
           ${PLACE}
          WHERE ${IN_SCOPE}`,
      )
      .bind(null, null, scope),
    db
      .prepare(
        `SELECT y.public_id AS id, y.label, y.status FROM academic_years y
          WHERE EXISTS (SELECT 1 FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id
                          JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
                         WHERE en.academic_year_id = y.id AND ${IN_SCOPE})
          ORDER BY y.start_date DESC, y.id DESC`,
      )
      .bind(null, null, scope),
  ]);

  const rows = list!.results as unknown as Row[];
  const count = (counts!.results[0] ?? {}) as { active?: number; in_open?: number; gone?: number };
  return {
    students: rows.map((r) => ({
      id: r.public_id,
      sid: r.sid,
      firstName: r.first_name,
      lastName: r.last_name,
      status: r.status,
      guardianPhone: r.guardian_phone,
      rollNo: r.roll_no,
      class: r.class_id ? { id: r.class_id, label: r.class_label ?? "", levelName: r.level_name ?? "", courseName: r.course_name ?? "", wingName: r.wing_name ?? "" } : null,
      term: r.term_id ? { id: r.term_id, label: r.term_label ?? "" } : null,
    })),
    total: (total!.results[0] as { n: number }).n,
    page,
    pageSize,
    counts: { active: count.active ?? 0, inOpenTerms: count.in_open ?? 0, leftOrGraduated: count.gone ?? 0 },
    wings: placeTree(places!.results as unknown as PlaceRow[]),
    terms: (terms!.results as unknown as { id: string; label: string; status: string }[]).map((t) => ({ id: t.id, label: t.label, open: t.status !== "closed" })),
  };
}

/** Flat rows, one per class with its count and already in order, into wings > courses > levels > classes with their sums. */
function placeTree(rows: readonly PlaceRow[]): StudentBrowse["wings"] {
  const wings: StudentBrowse["wings"] = [];
  for (const r of rows) {
    let wing = wings.find((w) => w.key === r.wing_key);
    if (!wing) wings.push((wing = { key: r.wing_key, name: r.wing_name, count: 0, courses: [] }));
    let course = wing.courses.find((c) => c.id === r.course_id);
    if (!course) wing.courses.push((course = { id: r.course_id, name: r.course_name, count: 0, levels: [] }));
    let level = course.levels.find((l) => l.id === r.level_id);
    if (!level) course.levels.push((level = { id: r.level_id, name: r.level_name, count: 0, classes: [] }));
    level.classes.push({ id: r.class_id, label: r.class_label, count: r.n });
    level.count += r.n;
    course.count += r.n;
    wing.count += r.n;
  }
  return wings;
}
