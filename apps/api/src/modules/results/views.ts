import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { adToBsText } from "../../core/dates";
import { rankResults, rankScore } from "./grading";
import { CLASS_JOINS, NAMING_COLUMNS, naming, sectionInReach, top20On, type Reach } from "./guard";
import type { CardBody, ClassSheet, MarksCard, OwnResults, Top20 } from "./schema";

/**
 * What people read (Phase 7, slice 4, D-082): the student's own results by year and terminal, a marks card, the Top 20
 * and the whole-class sheet. Everything is read from the stored snapshots (the latest version of each card), never
 * recomputed, so a later policy change never touches a published result.
 */

const bsOf = (iso: string) => adToBsText(iso.slice(0, 10));

/** The latest card of each (publication, enrollment): a join condition on `mc`. */
const LATEST = `mc.version = (SELECT MAX(v.version) FROM marks_cards v WHERE v.publication_id = mc.publication_id AND v.enrollment_id = mc.enrollment_id)`;

interface CardRow {
  card_id: string;
  version: number;
  body: string;
  reason: string | null;
  created_at: string;
  published_at: string;
}

const toCard = (r: CardRow): MarksCard => ({
  id: r.card_id,
  version: r.version,
  publishedAt: r.published_at,
  publishedAtBs: bsOf(r.published_at),
  reason: r.reason,
  body: JSON.parse(r.body) as CardBody,
});

/** The student's own published results, every year, newest first, each with its rechecks. Found from the sign-in. */
export async function ownResults(db: D1Database, me: string): Promise<OwnResults> {
  const [cards, rechecks] = await db.batch([
    db
      .prepare(
        `SELECT rp.public_id AS publication_id, ay.label AS year_label, t.name AS terminal_name,
                mc.public_id AS card_id, mc.version, mc.body, mc.reason, mc.created_at, rp.published_at
           FROM students st JOIN enrollments en ON en.student_id = st.id JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN marks_cards mc ON mc.enrollment_id = en.id AND ${LATEST}
           JOIN result_publications rp ON rp.id = mc.publication_id JOIN terminals t ON t.id = rp.terminal_id
          WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1)
          ORDER BY ay.bs_year DESC, t.ordinal DESC`,
      )
      .bind(me),
    db
      .prepare(
        `SELECT r.public_id AS id, rp.public_id AS publication_id, o.public_id AS offering_id, sb.name AS subject_name, r.reason, r.status,
                r.requested_at, r.decision_reason
           FROM students st JOIN enrollments en ON en.student_id = st.id JOIN rechecks r ON r.enrollment_id = en.id
           JOIN mark_sheets ms ON ms.id = r.sheet_id JOIN subject_offerings o ON o.id = ms.offering_id JOIN subjects sb ON sb.id = o.subject_id
           JOIN result_publications rp ON rp.class_id = ms.class_id AND rp.terminal_id = ms.terminal_id
          WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1)
          ORDER BY r.id DESC`,
      )
      .bind(me),
  ]);
  const checks = rechecks!.results as unknown as { id: string; publication_id: string; offering_id: string; subject_name: string; reason: string; status: "open" | "changed" | "unchanged"; requested_at: string; decision_reason: string | null }[];
  return {
    results: (cards!.results as unknown as (CardRow & { publication_id: string; year_label: string; terminal_name: string })[]).map((r) => ({
      publicationId: r.publication_id,
      yearLabel: r.year_label,
      terminalName: r.terminal_name,
      card: toCard(r),
      rechecks: checks
        .filter((c) => c.publication_id === r.publication_id)
        .map((c) => ({ id: c.id, offeringId: c.offering_id, subjectName: c.subject_name, reason: c.reason, status: c.status, requestedAt: c.requested_at, decisionReason: c.decision_reason })),
    })),
  };
}

/** One card by id, for staff whose sections reach its class. Any version (a recheck keeps the old ones). */
export async function staffCard(db: D1Database, reach: Reach, cardId: string): Promise<MarksCard | null> {
  const row = await db
    .prepare(
      `SELECT mc.public_id AS card_id, mc.version, mc.body, mc.reason, mc.created_at, rp.published_at
         FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id JOIN classes cl ON cl.id = rp.class_id ${CLASS_JOINS}
        WHERE mc.public_id = ?1 AND ${sectionInReach(2)}`,
    )
    .bind(cardId, reach.institution, reach.sections)
    .first<CardRow>();
  return row ? toCard(row) : null;
}

interface PoolRow {
  enrollment_id: string;
  name: string;
  class_name: string;
  section_key: string;
  section_name: string;
  level_ordinal: number;
  level_name: string;
  policy: string;
  gpa_hundredths: number | null;
  percent_hundredths: number | null;
  passed: number;
}

/**
 * The Top 20 for a terminal: ranked per section (CLAUDE.md section 6), among the same level of that section (Grade 11
 * with Grade 11; "their own year and terminal", source 6.3) and the same grading policy, from published classes only.
 * Ties share a rank, so a list can run past 20 people. A student sees only their own pool, name and rank only, and only
 * once their own class is published; staff see every pool in reach with the class and the score.
 * OPEN: the pool (same level across a section's programmes) is our reading; the client may want it per programme.
 */
export async function top20(db: D1Database, viewer: { student: string } | { reach: Reach }, terminalId: string | undefined): Promise<Top20 | null> {
  const on = await db.prepare(`SELECT (${top20On}) AS on_`).first<{ on_: number }>();
  if (on?.on_ !== 1) return null;
  const isStudent = "student" in viewer;
  const terminals = (
    await db
      .prepare(
        isStudent
          ? `SELECT DISTINCT t.public_id AS id, t.name, t.ordinal FROM students st JOIN enrollments en ON en.student_id = st.id JOIN academic_years ay ON ay.id = en.academic_year_id AND ay.status = 'active'
               JOIN result_publications rp ON rp.class_id = en.class_id JOIN terminals t ON t.id = rp.terminal_id
              WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) ORDER BY t.ordinal`
          : `SELECT t.public_id AS id, t.name FROM terminals t JOIN academic_years ay ON ay.id = t.academic_year_id WHERE ay.status = 'active' ORDER BY t.ordinal`,
      )
      .bind(...(isStudent ? [viewer.student] : []))
      .all<{ id: string; name: string }>()
  ).results.map((t) => ({ id: t.id, name: t.name }));
  const chosen = terminalId && terminals.some((t) => t.id === terminalId) ? terminalId : (terminals[terminals.length - 1]?.id ?? null);
  if (!chosen) return { terminals, terminalId: null, pools: [] };

  const own = isStudent
    ? await db
        .prepare(
          `SELECT s.key AS section_key, lv.ordinal AS level_ordinal, pv.grading_policy AS policy
             FROM students st JOIN enrollments en ON en.student_id = st.id JOIN academic_years ay ON ay.id = en.academic_year_id AND ay.status = 'active'
             JOIN classes cl ON cl.id = en.class_id ${CLASS_JOINS}
             JOIN terminals t ON t.public_id = ?2 JOIN result_publications rp ON rp.class_id = cl.id AND rp.terminal_id = t.id
            WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1)`,
        )
        .bind(viewer.student, chosen)
        .first<{ section_key: string; level_ordinal: number; policy: string }>()
    : null;
  if (isStudent && !own) return { terminals, terminalId: chosen, pools: [] };

  const { results } = await db
    .prepare(
      `SELECT en.public_id AS enrollment_id, st.first_name || ' ' || st.last_name AS name,
              pv.name || ' ' || lv.name || CASE WHEN cl.label = '' THEN '' ELSE ' ' || cl.label END AS class_name,
              s.key AS section_key, s.name AS section_name, lv.ordinal AS level_ordinal, lv.name AS level_name, rp.grading_policy AS policy,
              mc.gpa_hundredths, mc.percent_hundredths, mc.passed
         FROM result_publications rp JOIN terminals t ON t.id = rp.terminal_id AND t.public_id = ?1
         JOIN classes cl ON cl.id = rp.class_id ${CLASS_JOINS}
         JOIN marks_cards mc ON mc.publication_id = rp.id AND ${LATEST}
         JOIN enrollments en ON en.id = mc.enrollment_id JOIN students st ON st.id = en.student_id
        WHERE ${isStudent ? "s.key = ?2 AND lv.ordinal = ?3 AND rp.grading_policy = ?4" : sectionInReach(2)}
        ORDER BY s.ordering, lv.ordinal, rp.grading_policy`,
    )
    .bind(chosen, ...(isStudent ? [own!.section_key, own!.level_ordinal, own!.policy] : [viewer.reach.institution, viewer.reach.sections]))
    .all<PoolRow>();

  const pools = new Map<string, PoolRow[]>();
  for (const r of results) {
    const key = `${r.section_key}|${r.level_ordinal}|${r.policy}`;
    pools.set(key, [...(pools.get(key) ?? []), r]);
  }
  return {
    terminals,
    terminalId: chosen,
    pools: [...pools.values()].map((rows) => {
      const ranked = rankResults(rows.map((r) => ({ id: r.enrollment_id, score: rankScore({ gpaHundredths: r.gpa_hundredths, percentHundredths: r.percent_hundredths }), passed: r.passed === 1 }))).filter((r) => r.rank <= 20);
      return {
        sectionName: rows[0]!.section_name,
        levelName: rows[0]!.level_name,
        entries: ranked.map((r) => {
          const row = rows.find((x) => x.enrollment_id === r.id)!;
          return isStudent ? { rank: r.rank, name: row.name } : { rank: r.rank, name: row.name, className: row.class_name, score: rankScore({ gpaHundredths: row.gpa_hundredths, percentHundredths: row.percent_hundredths }) };
        }),
      };
    }),
  };
}

/** The whole-class sheet (source 6.3): students by subjects, with the GPA or percentage and the rank within the class. */
export async function classSheet(db: D1Database, reach: Reach, classId: string, terminalId: string): Promise<ClassSheet | null> {
  const [head, cards] = await db.batch([
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, t.public_id AS terminal_id, t.name AS terminal_name, rp.grading_policy, rp.published_at
           FROM classes cl ${CLASS_JOINS} JOIN terminals t ON t.public_id = ?2 JOIN result_publications rp ON rp.class_id = cl.id AND rp.terminal_id = t.id
          WHERE cl.public_id = ?1 AND ${sectionInReach(3)}`,
      )
      .bind(classId, terminalId, reach.institution, reach.sections),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, mc.public_id AS card_id, mc.version, mc.body, mc.gpa_hundredths, mc.percent_hundredths, mc.passed, mc.outcome
           FROM classes cl JOIN terminals t ON t.public_id = ?2 JOIN result_publications rp ON rp.class_id = cl.id AND rp.terminal_id = t.id
           JOIN marks_cards mc ON mc.publication_id = rp.id AND ${LATEST} JOIN enrollments en ON en.id = mc.enrollment_id
          WHERE cl.public_id = ?1
          ORDER BY en.roll_no, en.id`,
      )
      .bind(classId, terminalId),
  ]);
  const h = head!.results[0] as { class_id: string; programme_name: string; level_name: string; label: string; terminal_id: string; terminal_name: string; grading_policy: "neb_gpa" | "percentage_division"; published_at: string } | undefined;
  if (!h) return null;
  const rows = (cards!.results as unknown as { enrollment_id: string; card_id: string; version: number; body: string; gpa_hundredths: number | null; percent_hundredths: number | null; passed: number; outcome: string }[]).map((r) => ({ ...r, card: JSON.parse(r.body) as CardBody }));
  const subjects: ClassSheet["subjects"] = [];
  for (const r of rows) for (const s of r.card.subjects) if (!subjects.some((x) => x.offeringId === s.offeringId)) subjects.push({ offeringId: s.offeringId, name: s.name });
  subjects.sort((a, b) => a.name.localeCompare(b.name));
  const ranks = new Map(rankResults(rows.map((r) => ({ id: r.enrollment_id, score: rankScore({ gpaHundredths: r.gpa_hundredths, percentHundredths: r.percent_hundredths }), passed: r.passed === 1 }))).map((r) => [r.id, r.rank]));
  return {
    classId: h.class_id,
    ...naming(h),
    terminal: { id: h.terminal_id, name: h.terminal_name },
    policy: h.grading_policy,
    publishedAt: h.published_at,
    subjects,
    students: rows.map((r) => ({
      enrollmentId: r.enrollment_id,
      cardId: r.card_id,
      sid: r.card.student.sid,
      name: r.card.student.name,
      rank: ranks.get(r.enrollment_id) ?? null,
      gpaHundredths: r.gpa_hundredths,
      percentHundredths: r.percent_hundredths,
      outcome: r.outcome,
      version: r.version,
      subjects: subjects.map((s) => {
        const got = r.card.subjects.find((x) => x.offeringId === s.offeringId);
        return got ? { offeringId: got.offeringId, grade: got.grade, percentHundredths: got.percentHundredths } : null;
      }),
    })),
  };
}

/** A cell for a spreadsheet: quoted, and never read as a formula. */
const cell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
const hundredths = (n: number | null) => (n === null ? "" : (n / 100).toFixed(2));

/** The whole-class sheet as CSV (Excel opens it). OPEN: a native .xlsx needs a library, which needs the PM. */
export function classSheetCsv(sheet: ClassSheet): string {
  const score = sheet.policy === "neb_gpa" ? "GPA" : "Percentage";
  const lines = [["Rank", "SID", "Student", ...sheet.subjects.map((s) => s.name), score, "Result"].map(cell).join(",")];
  for (const s of sheet.students) {
    lines.push(
      [
        s.rank,
        s.sid,
        s.name,
        ...s.subjects.map((x) => (x === null ? "" : sheet.policy === "neb_gpa" ? x.grade : hundredths(x.percentHundredths))),
        hundredths(sheet.policy === "neb_gpa" ? s.gpaHundredths : s.percentHundredths),
        s.outcome,
      ]
        .map(cell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface ResultsDashboard {
  publications: number;
  lastPublishedAt: string | null;
  byProgramme: { id: string; name: string; policy: string | null; cards: number; passed: number; avgGpaHundredths: number | null; avgPercentHundredths: number | null }[];
}

/**
 * The dashboard's results (D-088): the active year's published terminals, and by programme how many published marks
 * cards passed, with the average GPA or percentage. Only each card's latest version counts (a recheck makes a new one).
 */
export function resultsDashboardPart(db: D1Database): DashboardPart<ResultsDashboard> {
  return {
    statements: [
      db.prepare(
        `SELECT COUNT(*) AS publications, MAX(rp.published_at) AS lastPublishedAt
           FROM result_publications rp JOIN classes cl ON cl.id = rp.class_id JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status = 'active'`,
      ),
      db.prepare(
        `SELECT pv.public_id AS id, pv.name, pv.grading_policy AS policy, COUNT(mc.id) AS cards, COALESCE(SUM(mc.passed), 0) AS passed,
                CAST(AVG(mc.gpa_hundredths) AS INTEGER) AS avgGpaHundredths, CAST(AVG(mc.percent_hundredths) AS INTEGER) AS avgPercentHundredths
           FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id JOIN classes cl ON cl.id = rp.class_id
           JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status = 'active'
           JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
          WHERE mc.version = (SELECT MAX(m2.version) FROM marks_cards m2 WHERE m2.publication_id = mc.publication_id AND m2.enrollment_id = mc.enrollment_id)
          GROUP BY pv.id ORDER BY pv.ordering`,
      ),
    ],
    read: ([totals, programmes]) => ({
      ...(rowsOf<{ publications: number; lastPublishedAt: string | null }>(totals)[0] ?? { publications: 0, lastPublishedAt: null }),
      byProgramme: rowsOf<ResultsDashboard["byProgramme"][number]>(programmes),
    }),
  };
}
