import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { adToBsText } from "../../core/dates";
import { rankResults } from "./grading";
import { CLASS_JOINS, NAMING_COLUMNS, naming, sectionInReach, top20On, type Reach } from "./guard";
import type { CardBody, ClassSheet, MarksCard, OwnResults, Top20 } from "./schema";

/**
 * What people read (Phase 7, slice 4, D-082; on the exam pattern since D-117): the student's own results, each
 * terminal's and the final; a marks card; the Top 20 on the final result; and the whole-class sheet. Everything is
 * read from the stored snapshots (the latest version of each card), never recomputed.
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

/** The student's own published results, every term, newest first: each terminal, then the final. Found from the sign-in. */
export async function ownResults(db: D1Database, me: string): Promise<OwnResults> {
  const [cards, rechecks] = await db.batch([
    db
      .prepare(
        `SELECT rp.public_id AS publication_id, ay.label AS year_label, t.name AS terminal_name,
                mc.public_id AS card_id, mc.version, mc.body, mc.reason, mc.created_at, rp.published_at
           FROM students st JOIN enrollments en ON en.student_id = st.id JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN marks_cards mc ON mc.enrollment_id = en.id AND ${LATEST}
           JOIN result_publications rp ON rp.id = mc.publication_id LEFT JOIN terminals t ON t.id = rp.terminal_id
          WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1)
          ORDER BY ay.start_date DESC, ay.id DESC, rp.terminal_id IS NULL DESC, t.ordinal DESC`,
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
    results: (cards!.results as unknown as (CardRow & { publication_id: string; year_label: string; terminal_name: string | null })[]).map((r) => ({
      publicationId: r.publication_id,
      yearLabel: r.year_label,
      kind: r.terminal_name === null ? ("final" as const) : ("terminal" as const),
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
  term_id: number;
  term_label: string;
  section_key: string;
  section_name: string;
  level_ordinal: number;
  level_name: string;
  percent_hundredths: number;
  passed: number;
}

/**
 * The Top 20 on the final result only (D-117): ranked per section (CLAUDE.md section 6), among the same level of that
 * section in the same open term (Grade 11 with Grade 11), from classes whose final result is out, by the final
 * percentage among students who passed. Ties share a rank, so a list can run past 20 people. A student sees only their
 * own list, name and rank only, once their own class's final is out; staff see every list in reach with class and score.
 * OPEN: the pool (same level across a section's programmes) is our reading; the client may want it per programme.
 */
export async function top20(db: D1Database, viewer: { student: string } | { reach: Reach }): Promise<Top20 | null> {
  const on = await db.prepare(`SELECT (${top20On}) AS on_`).first<{ on_: number }>();
  if (on?.on_ !== 1) return null;
  const isStudent = "student" in viewer;
  const own = isStudent
    ? await db
        .prepare(
          `SELECT ay.id AS term_id, s.key AS section_key, lv.ordinal AS level_ordinal
             FROM students st JOIN enrollments en ON en.student_id = st.id JOIN academic_years ay ON ay.id = en.academic_year_id AND ay.status = 'active'
             JOIN classes cl ON cl.id = en.class_id ${CLASS_JOINS}
             JOIN result_publications rp ON rp.class_id = cl.id AND rp.terminal_id IS NULL
            WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1)`,
        )
        .bind(viewer.student)
        .first<{ term_id: number; section_key: string; level_ordinal: number }>()
    : null;
  if (isStudent && !own) return { pools: [] };

  const { results } = await db
    .prepare(
      `SELECT en.public_id AS enrollment_id, st.first_name || ' ' || st.last_name AS name,
              pv.name || ' ' || lv.name || CASE WHEN cl.label = '' THEN '' ELSE ' ' || cl.label END AS class_name,
              ay.id AS term_id, ay.label AS term_label, s.key AS section_key, s.name AS section_name, lv.ordinal AS level_ordinal, lv.name AS level_name,
              mc.percent_hundredths, mc.passed
         FROM result_publications rp JOIN classes cl ON cl.id = rp.class_id ${CLASS_JOINS}
         JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status = 'active'
         JOIN marks_cards mc ON mc.publication_id = rp.id AND ${LATEST}
         JOIN enrollments en ON en.id = mc.enrollment_id JOIN students st ON st.id = en.student_id
        WHERE rp.terminal_id IS NULL AND ${isStudent ? "ay.id = ?1 AND s.key = ?2 AND lv.ordinal = ?3" : sectionInReach(1)}
        ORDER BY ay.start_date, ay.id, s.ordering, lv.ordinal`,
    )
    .bind(...(isStudent ? [own!.term_id, own!.section_key, own!.level_ordinal] : [viewer.reach.institution, viewer.reach.sections]))
    .all<PoolRow>();

  // Grouped in one pass (each row pushed, never the list copied), and each ranked entry found by id, not by a search.
  const pools = new Map<string, PoolRow[]>();
  for (const r of results) {
    const key = `${r.term_id}|${r.section_key}|${r.level_ordinal}`;
    const pool = pools.get(key);
    if (pool) pool.push(r);
    else pools.set(key, [r]);
  }
  return {
    pools: [...pools.values()].map((rows) => {
      const byId = new Map(rows.map((x) => [x.enrollment_id, x]));
      const ranked = rankResults(rows.map((r) => ({ id: r.enrollment_id, score: r.percent_hundredths, passed: r.passed === 1 }))).filter((r) => r.rank <= 20);
      return {
        termLabel: rows[0]!.term_label,
        sectionName: rows[0]!.section_name,
        levelName: rows[0]!.level_name,
        entries: ranked.map((r) => {
          const row = byId.get(r.id)!;
          return isStudent ? { rank: r.rank, name: row.name } : { rank: r.rank, name: row.name, className: row.class_name, score: row.percent_hundredths };
        }),
      };
    }),
  };
}

/**
 * The whole-class sheet (source 6.3) of a terminal, or of the final result (`terminalId` null): students by subjects,
 * with the percentage, the grade when graded, and on the final the pass or fail and the rank in the class.
 * `classTeacher`: only a class this person leads (a Class Teacher reading their own class, FUT point 19).
 */
export async function classSheet(db: D1Database, reach: Reach, classId: string, terminalId: string | null, classTeacher: string | null = null): Promise<ClassSheet | null> {
  const [head, cards] = await db.batch([
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, t.public_id AS terminal_id, t.name AS terminal_name, rp.pattern, rp.published_at
           FROM classes cl ${CLASS_JOINS} JOIN result_publications rp ON rp.class_id = cl.id
           LEFT JOIN terminals t ON t.id = rp.terminal_id
          WHERE cl.public_id = ?1 AND (CASE WHEN ?2 IS NULL THEN rp.terminal_id IS NULL ELSE t.public_id = ?2 END) AND ${sectionInReach(3)}
            AND (?5 IS NULL OR cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?5))`,
      )
      .bind(classId, terminalId, reach.institution, reach.sections, classTeacher),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, mc.public_id AS card_id, mc.version, mc.body, mc.percent_hundredths, mc.passed, mc.outcome
           FROM classes cl JOIN result_publications rp ON rp.class_id = cl.id LEFT JOIN terminals t ON t.id = rp.terminal_id
           JOIN marks_cards mc ON mc.publication_id = rp.id AND ${LATEST} JOIN enrollments en ON en.id = mc.enrollment_id
          WHERE cl.public_id = ?1 AND (CASE WHEN ?2 IS NULL THEN rp.terminal_id IS NULL ELSE t.public_id = ?2 END)
          ORDER BY en.roll_no, en.id`,
      )
      .bind(classId, terminalId),
  ]);
  const h = head!.results[0] as { class_id: string; programme_name: string; level_name: string; label: string; terminal_id: string | null; terminal_name: string | null; pattern: string; published_at: string } | undefined;
  if (!h) return null;
  const rows = (cards!.results as unknown as { enrollment_id: string; card_id: string; version: number; body: string; percent_hundredths: number; passed: number | null; outcome: string }[]).map((r) => ({
    ...r,
    card: JSON.parse(r.body) as CardBody,
  }));
  const subjects: ClassSheet["subjects"] = [];
  for (const r of rows) for (const s of r.card.subjects) if (!subjects.some((x) => x.offeringId === s.offeringId)) subjects.push({ offeringId: s.offeringId, name: s.name });
  subjects.sort((a, b) => a.name.localeCompare(b.name));
  const isFinal = h.terminal_id === null;
  const ranks = isFinal ? new Map(rankResults(rows.map((r) => ({ id: r.enrollment_id, score: r.percent_hundredths, passed: r.passed === 1 }))).map((r) => [r.id, r.rank])) : new Map<string, number>();
  return {
    classId: h.class_id,
    ...naming(h),
    terminal: h.terminal_id === null ? null : { id: h.terminal_id, name: h.terminal_name! },
    graded: (JSON.parse(h.pattern) as { graded: boolean }).graded,
    publishedAt: h.published_at,
    subjects,
    students: rows.map((r) => ({
      enrollmentId: r.enrollment_id,
      cardId: r.card_id,
      sid: r.card.student.sid,
      name: r.card.student.name,
      rank: ranks.get(r.enrollment_id) ?? null,
      percentHundredths: r.percent_hundredths,
      passed: r.passed === null ? null : r.passed === 1,
      outcome: r.outcome,
      version: r.version,
      subjects: subjects.map((s) => {
        if (r.card.kind === "final") {
          const got = r.card.subjects.find((x) => x.offeringId === s.offeringId);
          return got ? { offeringId: got.offeringId, grade: got.grade, percentHundredths: got.finalHundredths } : null;
        }
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
  const isFinal = sheet.terminal === null;
  const lines = [[...(isFinal ? ["Rank"] : []), "SID", "Student", ...sheet.subjects.map((s) => s.name), "Percentage", "Result"].map(cell).join(",")];
  for (const s of sheet.students) {
    lines.push(
      [
        ...(isFinal ? [s.rank] : []),
        s.sid,
        s.name,
        ...s.subjects.map((x) => (x === null ? "" : sheet.graded && x.grade !== null ? `${hundredths(x.percentHundredths)} (${x.grade})` : hundredths(x.percentHundredths))),
        hundredths(s.percentHundredths),
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
  byProgramme: { id: string; name: string; cards: number; passed: number; avgPercentHundredths: number | null }[];
}

/**
 * The dashboard's results (D-088): the active terms' publications, and by programme how many final results passed,
 * with the average final percentage (D-117: only a final passes or fails). Only each card's latest version counts.
 */
export function resultsDashboardPart(db: D1Database): DashboardPart<ResultsDashboard> {
  return {
    statements: [
      db.prepare(
        `SELECT COUNT(*) AS publications, MAX(rp.published_at) AS lastPublishedAt
           FROM result_publications rp JOIN classes cl ON cl.id = rp.class_id JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status = 'active'`,
      ),
      db.prepare(
        `SELECT pv.public_id AS id, pv.name, COUNT(mc.id) AS cards, COALESCE(SUM(mc.passed), 0) AS passed,
                CAST(AVG(mc.percent_hundredths) AS INTEGER) AS avgPercentHundredths
           FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id AND rp.terminal_id IS NULL JOIN classes cl ON cl.id = rp.class_id
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
