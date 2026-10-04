import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { CLASS_JOINS, NAMING_COLUMNS, coordinatorFor, missingCount, naming, readyToPublish, sectionInReach, takes, teacherName, teaches, type Reach } from "./guard";
import { BulkVerifySchema, SaveMarksSchema, SendBackSchema, type MarkSheet, type MyMarkSheets, type ReviewBoard, type SaveMarks, type SheetStatus } from "./schema";

/**
 * Mark sheets (Phase 7, slices 2 and 3, D-080, D-081): one per class, subject and terminal. The subject's teacher
 * enters marks per component in a bulk grid and saves drafts; submits when nothing is missing; the Co-ordinator
 * verifies or sends it back with a note, one or many at once. The database refuses a mark on anything but a draft.
 */

export type Write = { ok: true } | { ok: false; reason: "not_found" | "year_closed" | "wrong_state" } | { ok: false; reason: "invalid" | "missing"; message: string };

const yearClosed = (error: unknown) => /academic year is closed/i.test(error instanceof Error ? error.message : String(error));

/**
 * The open terms' exams (terminals), term by term and oldest first. With more than one term open, each is named with its
 * term, so "Final" of one term is never mistaken for another's (D-110).
 */
export const TERMINALS = `SELECT t.public_id AS id,
                                 CASE WHEN (SELECT COUNT(*) FROM academic_years x WHERE x.status = 'active') > 1 THEN ay.label || ' · ' || t.name ELSE t.name END AS name
                            FROM terminals t JOIN academic_years ay ON ay.id = t.academic_year_id
                           WHERE ay.status = 'active' ORDER BY ay.start_date, ay.id, t.ordinal`;

/** The teacher's subjects this year, each with its sheet's state per terminal. */
export async function mySheets(db: D1Database, me: string): Promise<MyMarkSheets> {
  const [terminals, rows] = await db.batch([
    db.prepare(TERMINALS),
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, o.public_id AS offering_id, sb.name AS subject_name,
                t.public_id AS terminal_id, ms.status, ms.note
           FROM teacher_assignments ta
           JOIN users u ON u.id = ta.teacher_user_id
           JOIN classes cl ON cl.id = ta.class_id ${CLASS_JOINS}
           JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN subject_offerings o ON o.id = ta.offering_id JOIN subjects sb ON sb.id = o.subject_id
           LEFT JOIN terminals t ON t.academic_year_id = ay.id
           LEFT JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id
          WHERE u.public_id = ?1 AND u.is_active = 1 AND ta.is_active = 1 AND ay.status = 'active'
          ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, sb.name, t.ordinal`,
      )
      .bind(me),
  ]);
  const subjects: MyMarkSheets["subjects"] = [];
  for (const r of rows!.results as unknown as { class_id: string; programme_name: string; level_name: string; label: string; offering_id: string; subject_name: string; terminal_id: string | null; status: SheetStatus | null; note: string | null }[]) {
    let entry = subjects[subjects.length - 1];
    if (!entry || entry.classId !== r.class_id || entry.offeringId !== r.offering_id) {
      subjects.push((entry = { classId: r.class_id, ...naming(r), offeringId: r.offering_id, subjectName: r.subject_name, sheets: [] }));
    }
    if (r.terminal_id) entry.sheets.push({ terminalId: r.terminal_id, status: r.status ?? "not_started", note: r.note });
  }
  return { terminals: terminals!.results as { id: string; name: string }[], subjects };
}

/** Who is looking at a sheet: the subject's own teacher, or staff whose sections reach the class. */
export type Viewer = { teacher: string } | { reach: Reach };

interface SheetHead {
  class_id: string;
  programme_name: string;
  level_name: string;
  label: string;
  offering_id: string;
  subject_name: string;
  terminal_id: string;
  terminal_name: string;
  sheet_id: string | null;
  status: SheetStatus | null;
  note: string | null;
  teacher_name: string | null;
  year_status: string;
  allowed: number;
}

/** A sheet by its class, subject and terminal (it may not exist yet: then it reads as not started). */
export async function loadSheet(db: D1Database, viewer: Viewer, classId: string, offeringId: string, terminalId: string): Promise<{ sheet: MarkSheet; yearStatus: string } | null> {
  const access = "teacher" in viewer ? teaches(4, "cl.id", "o.id") : sectionInReach(5);
  const [head, components, students] = await db.batch([
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, o.public_id AS offering_id, sb.name AS subject_name, t.public_id AS terminal_id, t.name AS terminal_name,
                ms.public_id AS sheet_id, ms.status, ms.note, ${teacherName} AS teacher_name, ay.status AS year_status, ${access} AS allowed
           FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN subject_offerings o ON o.level_id = cl.level_id AND o.public_id = ?2 JOIN subjects sb ON sb.id = o.subject_id
           JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?3
           LEFT JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id
          WHERE cl.public_id = ?1`,
      )
      .bind(...[classId, offeringId, terminalId], ...("teacher" in viewer ? [viewer.teacher] : [null, viewer.reach.institution, viewer.reach.sections])),
    db
      .prepare(
        `SELECT mc.public_id AS id, mc.name, mc.kind, mc.max_hundredths FROM subject_offerings o JOIN mark_components mc ON mc.offering_id = o.id AND mc.is_active = 1
          WHERE o.public_id = ?1 ORDER BY mc.ordinal`,
      )
      .bind(offeringId),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, st.sid, st.first_name || ' ' || st.last_name AS name, en.roll_no,
                (SELECT json_group_array(json_object('c', mc.public_id, 'v', m.value_hundredths, 'a', m.absent))
                   FROM marks m JOIN mark_sheets ms ON ms.id = m.sheet_id JOIN mark_components mc ON mc.id = m.component_id
                  WHERE m.enrollment_id = en.id AND ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id) AS marks
           FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id AND o.public_id = ?2
           JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?3
           JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
          WHERE cl.public_id = ?1 AND ${takes("en", "o")}
          ORDER BY en.roll_no, st.first_name, st.last_name`,
      )
      .bind(classId, offeringId, terminalId),
  ]);
  const h = head!.results[0] as unknown as SheetHead | undefined;
  if (!h || h.allowed !== 1) return null;
  const comps = (components!.results as unknown as { id: string; name: string; kind: "theory" | "practical"; max_hundredths: number }[]).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    maxHundredths: c.max_hundredths,
  }));
  let missing = 0;
  const people = (students!.results as unknown as { enrollment_id: string; sid: string; name: string; roll_no: number | null; marks: string }[]).map((s) => {
    const entered = JSON.parse(s.marks) as { c: string; v: number | null; a: number }[];
    const marks = comps.map((c) => {
      const m = entered.find((e) => e.c === c.id);
      const value = m?.v ?? null;
      const absent = m?.a === 1;
      if (value === null && !absent) missing++;
      return { componentId: c.id, valueHundredths: value, absent };
    });
    return { enrollmentId: s.enrollment_id, sid: s.sid, name: s.name, rollNo: s.roll_no, marks };
  });
  return {
    yearStatus: h.year_status,
    sheet: {
      sheetId: h.sheet_id,
      classId: h.class_id,
      ...naming(h),
      offeringId: h.offering_id,
      subjectName: h.subject_name,
      terminal: { id: h.terminal_id, name: h.terminal_name },
      teacherName: h.teacher_name,
      status: h.status ?? "not_started",
      note: h.note,
      components: comps,
      students: people,
      missing,
    },
  };
}

/** The teacher saves marks (a draft; saving again replaces). Only on a draft sheet, only by the subject's teacher. */
export async function saveMarks(db: D1Database, auditKey: string, me: string, classId: string, offeringId: string, terminalId: string, input: SaveMarks): Promise<Write> {
  const parsed = SaveMarksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const loaded = await loadSheet(db, { teacher: me }, classId, offeringId, terminalId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (loaded.yearStatus === "closed") return { ok: false, reason: "year_closed" };
  if (loaded.yearStatus !== "active") return { ok: false, reason: "not_found" };
  const { sheet } = loaded;
  if (sheet.status !== "draft" && sheet.status !== "not_started") return { ok: false, reason: "wrong_state" };
  for (const m of parsed.data.marks) {
    const component = sheet.components.find((c) => c.id === m.componentId);
    if (!component || !sheet.students.some((s) => s.enrollmentId === m.enrollmentId)) return { ok: false, reason: "invalid", message: "A mark is for a student or component not on this sheet" };
    if (m.valueHundredths !== null && m.valueHundredths > component.maxHundredths) {
      return { ok: false, reason: "invalid", message: `A mark in ${component.name} is above its maximum of ${component.maxHundredths / 100}` };
    }
  }

  const at = new Date().toISOString();
  const place = `FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id AND o.public_id = ?2 JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?3
                 WHERE cl.public_id = ?1 AND ${teaches(4, "cl.id", "o.id")}`;
  const openSheet = db
    .prepare(
      `INSERT INTO mark_sheets (public_id, class_id, offering_id, terminal_id, created_at, updated_at)
       SELECT ?5, cl.id, o.id, t.id, ?6, ?6 ${place}
       ON CONFLICT (class_id, offering_id, terminal_id) DO NOTHING`,
    )
    .bind(classId, offeringId, terminalId, me, newPublicId(), at);
  const rows = parsed.data.marks.map((m) => ({ e: m.enrollmentId, c: m.componentId, v: m.valueHundredths, a: m.absent ? 1 : 0 }));
  const upsert = db
    .prepare(
      `INSERT INTO marks (sheet_id, enrollment_id, component_id, value_hundredths, absent, updated_by_user_id, updated_at)
       SELECT ms.id, en.id, mc.id, json_extract(j.value, '$.v'), json_extract(j.value, '$.a'), u.id, ?6
         FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id AND o.public_id = ?2
         JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?3
         JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id AND ms.status = 'draft'
         JOIN json_each(?5) j
         JOIN enrollments en ON en.public_id = json_extract(j.value, '$.e') AND en.class_id = cl.id AND en.status = 'active'
         JOIN mark_components mc ON mc.public_id = json_extract(j.value, '$.c') AND mc.offering_id = o.id AND mc.is_active = 1
         JOIN users u ON u.public_id = ?4
        WHERE cl.public_id = ?1 AND ${teaches(4, "cl.id", "o.id")} AND ${takes("en", "o")}
       ON CONFLICT (sheet_id, enrollment_id, component_id) DO UPDATE
         SET value_hundredths = excluded.value_hundredths, absent = excluded.absent, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .bind(classId, offeringId, terminalId, me, JSON.stringify(rows), at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.marks.saved",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: me,
        summary: `Marks saved for ${sheet.subjectName}, ${sheet.terminal.name}`,
        after: { offeringId, terminalId, count: rows.length },
      },
      [openSheet, upsert],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "wrong_state" };
  } catch (error) {
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    if (/only change on a draft/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "wrong_state" };
    throw error;
  }
}

/** The teacher sends a complete draft for review. Refused while any mark is missing (entered, or marked absent). */
export async function submitSheet(db: D1Database, auditKey: string, me: string, classId: string, offeringId: string, terminalId: string): Promise<Write> {
  const loaded = await loadSheet(db, { teacher: me }, classId, offeringId, terminalId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (loaded.yearStatus === "closed") return { ok: false, reason: "year_closed" };
  const { sheet } = loaded;
  if (sheet.status !== "draft" || !sheet.sheetId) return { ok: false, reason: "wrong_state" };
  if (sheet.missing > 0) return { ok: false, reason: "missing", message: `${sheet.missing} ${sheet.missing === 1 ? "mark is" : "marks are"} still missing` };
  if (sheet.students.length === 0) return { ok: false, reason: "missing", message: "No student takes this subject" };

  const at = new Date().toISOString();
  const update = db
    .prepare(
      `UPDATE mark_sheets SET status = 'under_review', note = NULL, submitted_by_user_id = (SELECT id FROM users WHERE public_id = ?2), submitted_at = ?3, updated_at = ?3
        WHERE public_id = ?1 AND status = 'draft'
          AND EXISTS (SELECT 1 FROM classes cl, subject_offerings o WHERE cl.id = mark_sheets.class_id AND o.id = mark_sheets.offering_id
                       AND ${teaches(2, "cl.id", "o.id")} AND ${missingCount("mark_sheets.terminal_id")} = 0)`,
    )
    .bind(sheet.sheetId, me, at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "results.sheet.submitted", entityType: "mark_sheet", entityPublicId: sheet.sheetId, actorPublicId: me, summary: `${sheet.subjectName}, ${sheet.terminal.name}: sent for review` },
      [update],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "wrong_state" };
  } catch (error) {
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    throw error;
  }
}

/** A sheet by its own id, for the Co-ordinator: its class, subject and terminal. */
export async function sheetPlace(db: D1Database, sheetId: string): Promise<{ classId: string; offeringId: string; terminalId: string } | null> {
  return db
    .prepare(
      `SELECT cl.public_id AS classId, o.public_id AS offeringId, t.public_id AS terminalId
         FROM mark_sheets ms JOIN classes cl ON cl.id = ms.class_id JOIN subject_offerings o ON o.id = ms.offering_id JOIN terminals t ON t.id = ms.terminal_id
        WHERE ms.public_id = ?1`,
    )
    .bind(sheetId)
    .first<{ classId: string; offeringId: string; terminalId: string }>();
}

/** The Co-ordinator's board for one terminal: every class in reach, each needed subject's state, and whether it can publish. */
export async function reviewBoard(db: D1Database, reach: Reach, terminalId: string | undefined): Promise<ReviewBoard> {
  // With none asked for, the board opens on the terminal in progress: the latest one any marks were started for, else
  // the first (Co-ordinator FUT F-07; it used to open on the last terminal, where nothing has started).
  const [listed, started] = await db.batch([
    db.prepare(TERMINALS),
    db.prepare(
      `SELECT t.public_id AS id FROM terminals t JOIN academic_years ay ON ay.id = t.academic_year_id
        WHERE ay.status = 'active' AND EXISTS (SELECT 1 FROM mark_sheets ms WHERE ms.terminal_id = t.id)
        ORDER BY t.ordinal DESC LIMIT 1`,
    ),
  ]);
  const terminals = listed!.results as { id: string; name: string }[];
  const inProgress = (started!.results[0] as { id: string } | undefined)?.id;
  const chosen = terminalId && terminals.some((t) => t.id === terminalId) ? terminalId : (inProgress ?? terminals[0]?.id ?? null);
  if (!chosen) return { terminals, terminalId: null, classes: [] };
  const { results } = await db
    .prepare(
      `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, pv.grading_policy,
              o.public_id AS offering_id, sb.name AS subject_name, ${teacherName} AS teacher_name,
              ms.public_id AS sheet_id, ms.status, ${missingCount("t.id")} AS missing,
              EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id) AS published,
              (${readyToPublish("t.id")}) AS ready
         FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
         JOIN terminals t ON t.academic_year_id = ay.id AND t.public_id = ?3
         JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
         LEFT JOIN mark_sheets ms ON ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = t.id
        WHERE ay.status = 'active' AND cl.is_active = 1 AND ${sectionInReach(1)}
          AND EXISTS (SELECT 1 FROM mark_components mc WHERE mc.offering_id = o.id AND mc.is_active = 1)
          AND EXISTS (SELECT 1 FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active' AND ${takes("en", "o")})
        ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, sb.name`,
    )
    .bind(reach.institution, reach.sections, chosen)
    .all<{
      class_id: string;
      programme_name: string;
      level_name: string;
      label: string;
      grading_policy: "neb_gpa" | "percentage_division" | null;
      offering_id: string;
      subject_name: string;
      teacher_name: string | null;
      sheet_id: string | null;
      status: SheetStatus | null;
      missing: number;
      published: number;
      ready: number;
    }>();
  const classes: ReviewBoard["classes"] = [];
  for (const r of results) {
    let entry = classes[classes.length - 1];
    if (!entry || entry.classId !== r.class_id) {
      classes.push((entry = { classId: r.class_id, ...naming(r), gradingPolicy: r.grading_policy, published: r.published === 1, ready: r.ready === 1 && r.published === 0 && r.grading_policy !== null, subjects: [] }));
    }
    entry.subjects.push({ offeringId: r.offering_id, subjectName: r.subject_name, teacherName: r.teacher_name, sheetId: r.sheet_id, status: r.status ?? "not_started", missing: r.missing });
  }
  return { terminals, terminalId: chosen, classes };
}

/** The section of a sheet's class (an SQL expression over `mark_sheets`). */
const SHEET_SECTION = `(SELECT pv.section_id FROM classes c2 JOIN levels lv ON lv.id = c2.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE c2.id = mark_sheets.class_id)`;

/** Verifies sheets under review, one or many. Answers how many were verified; the others were not under review or not in reach. */
export async function verifySheets(db: D1Database, auditKey: string, me: string, input: { sheetIds: string[] }): Promise<{ ok: true; verified: number } | { ok: false; reason: "invalid"; message: string } | { ok: false; reason: "year_closed" }> {
  const parsed = BulkVerifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const ids = [...new Set(parsed.data.sheetIds)];
  const at = new Date().toISOString();
  const update = db
    .prepare(
      `UPDATE mark_sheets SET status = 'verified', verified_by_user_id = (SELECT id FROM users WHERE public_id = ?2), verified_at = ?3, updated_at = ?3
        WHERE public_id IN (SELECT value FROM json_each(?1)) AND status = 'under_review' AND ${coordinatorFor(2, SHEET_SECTION)}`,
    )
    .bind(JSON.stringify(ids), me, at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "results.sheets.verified", entityType: "mark_sheet", entityPublicId: ids.length === 1 ? ids[0]! : null, actorPublicId: me, summary: `${ids.length} mark sheet(s) verified`, after: { sheetIds: ids } },
      [update],
      { onlyIfLastChanged: true },
    );
    if (!applied) return { ok: true, verified: 0 };
    const verified = await db
      .prepare(`SELECT COUNT(*) AS n FROM mark_sheets WHERE public_id IN (SELECT value FROM json_each(?1)) AND status = 'verified' AND verified_at = ?2`)
      .bind(JSON.stringify(ids), at)
      .first<{ n: number }>();
    return { ok: true, verified: verified?.n ?? 0 };
  } catch (error) {
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    throw error;
  }
}

/** Sends a sheet under review (or verified, not yet published) back to its teacher as a draft, with a note. */
export async function sendBack(db: D1Database, auditKey: string, me: string, sheetId: string, input: { note: string }): Promise<Write> {
  const parsed = SendBackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const update = db
    .prepare(
      `UPDATE mark_sheets SET status = 'draft', note = ?3, verified_by_user_id = NULL, verified_at = NULL, updated_at = ?4
        WHERE public_id = ?1 AND status IN ('under_review', 'verified') AND ${coordinatorFor(2, SHEET_SECTION)}
          AND NOT EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = mark_sheets.class_id AND rp.terminal_id = mark_sheets.terminal_id)`,
    )
    .bind(sheetId, me, parsed.data.note, new Date().toISOString());
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "results.sheet.sent_back", entityType: "mark_sheet", entityPublicId: sheetId, actorPublicId: me, summary: "Mark sheet sent back to the teacher", reason: parsed.data.note },
      [update],
      { onlyIfLastChanged: true },
    );
    if (applied) return { ok: true };
    const seen = await db.prepare(`SELECT ${coordinatorFor(2, SHEET_SECTION)} AS allowed FROM mark_sheets WHERE public_id = ?1`).bind(sheetId, me).first<{ allowed: number }>();
    return { ok: false, reason: seen?.allowed === 1 ? "wrong_state" : "not_found" };
  } catch (error) {
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    throw error;
  }
}
