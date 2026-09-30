import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { gradeResult, type GradingPolicy } from "./grading";
import { CLASS_JOINS, NAMING_COLUMNS, coordinatorFor, naming, sectionInReach, type Reach } from "./guard";
import { HEAD_COLUMNS, cardBody, groupMarks, marksQuery, type ClassHead } from "./publish";
import { DecideRecheckSchema, RequestRecheckSchema, type DecideRecheck, type RecheckList, type RequestRecheck } from "./schema";

/**
 * Rechecks (source 6.9; Phase 7, slice 5, D-083). A student asks for one published subject to be rechecked, with a
 * reason; the Co-ordinator is shown it at once, and decides: unchanged, or changed, which edits the marks and makes the
 * next version of the marks card in one batch, both with a reason. Section 9's default: the Admin is told of every
 * post-publish change (the changes list), and the student sees the decision and the new card. The earlier card stays.
 */

export type RecheckWrite =
  | { ok: true; id?: string }
  | { ok: false; reason: "not_found" | "year_closed" | "already_open" | "already_decided" }
  | { ok: false; reason: "invalid" | "cannot_grade"; message: string };

const yearClosed = (error: unknown) => /academic year is closed/i.test(error instanceof Error ? error.message : String(error));

/** The student asks for a recheck of one subject of one of their own published results. */
export async function requestRecheck(db: D1Database, auditKey: string, me: string, publicationId: string, input: RequestRecheck): Promise<RecheckWrite> {
  const parsed = RequestRecheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const id = newPublicId();
  const insert = db
    .prepare(
      `INSERT INTO rechecks (public_id, enrollment_id, sheet_id, reason, requested_at)
       SELECT ?4, en.id, ms.id, ?5, ?6
         FROM result_publications rp JOIN enrollments en ON en.class_id = rp.class_id
         JOIN students st ON st.id = en.student_id AND st.user_id = (SELECT id FROM users WHERE public_id = ?1 AND is_active = 1)
         JOIN subject_offerings o ON o.public_id = ?3
         JOIN mark_sheets ms ON ms.class_id = rp.class_id AND ms.terminal_id = rp.terminal_id AND ms.offering_id = o.id AND ms.status = 'published'
        WHERE rp.public_id = ?2
          AND EXISTS (SELECT 1 FROM marks_cards mc WHERE mc.publication_id = rp.id AND mc.enrollment_id = en.id)
          AND EXISTS (SELECT 1 FROM marks m WHERE m.sheet_id = ms.id AND m.enrollment_id = en.id)`,
    )
    .bind(me, publicationId, parsed.data.offeringId, id, parsed.data.reason, new Date().toISOString());
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      { action: "results.recheck.requested", entityType: "recheck", entityPublicId: id, actorPublicId: me, summary: "Recheck requested", reason: parsed.data.reason, after: { publicationId, offeringId: parsed.data.offeringId } },
      [insert],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true, id } : { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    if (/UNIQUE constraint failed: rechecks/i.test(message)) return { ok: false, reason: "already_open" };
    throw error;
  }
}

/** Rechecks in reach, open ones first, each with the student's current marks in that subject. */
export async function listRechecks(db: D1Database, reach: Reach): Promise<RecheckList> {
  const { results } = await db
    .prepare(
      `SELECT r.public_id AS id, o.public_id AS offering_id, sb.name AS subject_name, r.reason, r.status, r.requested_at, r.decision_reason, r.decided_at,
              du.full_name AS decided_by, cl.public_id AS class_id, ${NAMING_COLUMNS}, t.name AS terminal_name,
              st.first_name || ' ' || st.last_name AS student_name, st.sid,
              (SELECT json_group_array(json_object('id', mc.public_id, 'n', mc.name, 'x', mc.max_hundredths, 'v', m.value_hundredths, 'a', COALESCE(m.absent, 0)))
                 FROM mark_components mc LEFT JOIN marks m ON m.component_id = mc.id AND m.sheet_id = ms.id AND m.enrollment_id = r.enrollment_id
                WHERE mc.offering_id = o.id AND mc.is_active = 1 ORDER BY mc.ordinal) AS marks
         FROM rechecks r JOIN mark_sheets ms ON ms.id = r.sheet_id JOIN classes cl ON cl.id = ms.class_id ${CLASS_JOINS}
         JOIN subject_offerings o ON o.id = ms.offering_id JOIN subjects sb ON sb.id = o.subject_id JOIN terminals t ON t.id = ms.terminal_id
         JOIN enrollments en ON en.id = r.enrollment_id JOIN students st ON st.id = en.student_id
         LEFT JOIN users du ON du.id = r.decided_by_user_id
        WHERE ${sectionInReach(1)}
        ORDER BY r.status = 'open' DESC, r.id DESC
        LIMIT 200`,
    )
    .bind(reach.institution, reach.sections)
    .all<{
      id: string;
      offering_id: string;
      subject_name: string;
      reason: string;
      status: "open" | "changed" | "unchanged";
      requested_at: string;
      decision_reason: string | null;
      decided_at: string | null;
      decided_by: string | null;
      class_id: string;
      programme_name: string;
      level_name: string;
      label: string;
      terminal_name: string;
      student_name: string;
      sid: string;
      marks: string;
    }>();
  return {
    rechecks: results.map((r) => ({
      id: r.id,
      offeringId: r.offering_id,
      subjectName: r.subject_name,
      reason: r.reason,
      status: r.status,
      requestedAt: r.requested_at,
      decisionReason: r.decision_reason,
      decidedAt: r.decided_at,
      decidedBy: r.decided_by,
      classId: r.class_id,
      ...naming(r),
      terminalName: r.terminal_name,
      studentName: r.student_name,
      sid: r.sid,
      marks: (JSON.parse(r.marks) as { id: string; n: string; x: number; v: number | null; a: number }[]).map((m) => ({ componentId: m.id, name: m.n, maxHundredths: m.x, valueHundredths: m.v, absent: m.a === 1 })),
    })),
  };
}

/** The Co-ordinator decides a recheck: unchanged, or changed with corrected marks and the next card version. */
export async function decideRecheck(db: D1Database, auditKey: string, me: string, recheckId: string, input: DecideRecheck): Promise<RecheckWrite> {
  const parsed = DecideRecheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const d = parsed.data;

  const found = await db
    .prepare(
      `SELECT r.status, en.public_id AS enrollment_id, cl.public_id AS class_id, t.public_id AS terminal_id, o.public_id AS offering_id, rp.public_id AS publication_id,
              rp.grading_policy, ${coordinatorFor(2, "pv.section_id")} AS allowed,
              (SELECT MAX(mc.version) FROM marks_cards mc WHERE mc.publication_id = rp.id AND mc.enrollment_id = en.id) AS version,
              (SELECT json_group_array(json_object('id', mc.public_id, 'x', mc.max_hundredths)) FROM mark_components mc WHERE mc.offering_id = o.id AND mc.is_active = 1) AS components
         FROM rechecks r JOIN enrollments en ON en.id = r.enrollment_id JOIN mark_sheets ms ON ms.id = r.sheet_id
         JOIN classes cl ON cl.id = ms.class_id ${CLASS_JOINS} JOIN terminals t ON t.id = ms.terminal_id JOIN subject_offerings o ON o.id = ms.offering_id
         JOIN result_publications rp ON rp.class_id = cl.id AND rp.terminal_id = t.id
        WHERE r.public_id = ?1`,
    )
    .bind(recheckId, me)
    .first<{ status: string; enrollment_id: string; class_id: string; terminal_id: string; offering_id: string; publication_id: string; grading_policy: GradingPolicy; allowed: number; version: number; components: string }>();
  if (!found || found.allowed !== 1) return { ok: false, reason: "not_found" };
  if (found.status !== "open") return { ok: false, reason: "already_decided" };

  const at = new Date().toISOString();
  const close = db
    .prepare(
      `UPDATE rechecks SET status = ?3, decided_by_user_id = (SELECT id FROM users WHERE public_id = ?2), decided_at = ?4, decision_reason = ?5
        WHERE public_id = ?1 AND status = 'open'
          AND EXISTS (SELECT 1 FROM mark_sheets ms JOIN classes cl ON cl.id = ms.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
                       WHERE ms.id = rechecks.sheet_id AND ${coordinatorFor(2, "pv.section_id")})`,
    )
    .bind(recheckId, me, d.outcome, at, d.reason);
  const event = {
    entityType: "recheck",
    entityPublicId: recheckId,
    actorPublicId: me,
    reason: d.reason,
  };

  try {
    if (d.outcome === "unchanged") {
      const { applied } = await recordAudit(db, auditKey, { ...event, action: "results.recheck.unchanged", summary: "Recheck decided: no change" }, [close], { onlyIfLastChanged: true });
      return applied ? { ok: true } : { ok: false, reason: "already_decided" };
    }

    const components = JSON.parse(found.components) as { id: string; x: number }[];
    for (const m of d.marks) {
      const c = components.find((x) => x.id === m.componentId);
      if (!c) return { ok: false, reason: "invalid", message: "A mark is for a component not in this subject" };
      if (m.valueHundredths !== null && m.valueHundredths > c.x) return { ok: false, reason: "invalid", message: "A mark is above its maximum" };
    }

    // Regrade from the student's current marks with the corrections in place, under the policy used at publish.
    const [headResult, marksResult] = await db.batch([
      db
        .prepare(`SELECT ${HEAD_COLUMNS} FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN terminals t ON t.public_id = ?2 WHERE cl.public_id = ?1`)
        .bind(found.class_id, found.terminal_id),
      marksQuery(db, found.class_id, found.terminal_id, found.enrollment_id),
    ]);
    const head = headResult!.results[0] as unknown as ClassHead;
    const student = groupMarks(marksResult!.results as never)[0];
    if (!student) return { ok: false, reason: "not_found" };
    const subject = student.subjects.find((s) => s.offeringId === found.offering_id);
    if (!subject) return { ok: false, reason: "not_found" };
    for (const m of d.marks) {
      const target = subject.components.find((c) => c.id === m.componentId);
      if (target) {
        target.valueHundredths = m.valueHundredths;
        target.absent = m.absent;
      }
    }
    let body: string;
    let graded: ReturnType<typeof gradeResult>;
    try {
      graded = gradeResult(found.grading_policy, student.subjects);
      body = JSON.stringify(cardBody(head, found.grading_policy, student, graded));
    } catch (error) {
      return { ok: false, reason: "cannot_grade", message: error instanceof Error ? error.message : String(error) };
    }

    const upsert = db
      .prepare(
        `INSERT INTO marks (sheet_id, enrollment_id, component_id, value_hundredths, absent, updated_by_user_id, updated_at)
         SELECT r.sheet_id, r.enrollment_id, mc.id, json_extract(j.value, '$.v'), json_extract(j.value, '$.a'), (SELECT id FROM users WHERE public_id = ?2), ?4
           FROM rechecks r JOIN mark_sheets ms ON ms.id = r.sheet_id JOIN json_each(?3) j
           JOIN mark_components mc ON mc.public_id = json_extract(j.value, '$.c') AND mc.offering_id = ms.offering_id
          WHERE r.public_id = ?1 AND r.status = 'open'
            AND EXISTS (SELECT 1 FROM classes cl JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
                         WHERE cl.id = ms.class_id AND ${coordinatorFor(2, "pv.section_id")})
         ON CONFLICT (sheet_id, enrollment_id, component_id) DO UPDATE
           SET value_hundredths = excluded.value_hundredths, absent = excluded.absent, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(recheckId, me, JSON.stringify(d.marks.map((m) => ({ c: m.componentId, v: m.valueHundredths, a: m.absent ? 1 : 0 }))), at);
    const card = db
      .prepare(
        `INSERT INTO marks_cards (public_id, publication_id, enrollment_id, version, gpa_hundredths, percent_hundredths, passed, outcome, body, reason, created_by_user_id, created_at)
         SELECT ?1, rp.id, en.id, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT id FROM users WHERE public_id = ?11), ?12
           FROM result_publications rp, enrollments en
          WHERE rp.public_id = ?2 AND en.public_id = ?3 AND changes() > 0`,
      )
      .bind(newPublicId(), found.publication_id, found.enrollment_id, found.version + 1, graded.gpaHundredths, graded.percentHundredths, graded.passed ? 1 : 0, graded.outcome, body, d.reason, me, at);
    const { applied } = await recordAudit(
      db,
      auditKey,
      { ...event, action: "results.recheck.changed", summary: `Recheck changed ${subject.name}; marks card version ${found.version + 1}`, after: { marks: d.marks, outcome: graded.outcome } },
      [upsert, close, card],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "already_decided" };
  } catch (error) {
    if (yearClosed(error)) return { ok: false, reason: "year_closed" };
    if (/only change on a draft|decided once/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "already_decided" };
    throw error;
  }
}
