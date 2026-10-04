import { recordAudit } from "../../core/audit";
import { nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { carryDues, enrollmentBalances } from "../fees";
import { coordinatorForSection } from "./guard";
import type { MoveInput, MoveResult, PromotionBoard } from "./schema";

/**
 * Moving students into the next term (D-109, D-110). After the Principal closes a term, the Co-ordinator moves each of
 * its students: Promote (into a class of the next level, in an open term), Repeat (a class of the same level), Leaving,
 * or Graduated (at the last level). Leaving and Graduated need zero dues (CLAUDE.md section 6). Nothing is written to the
 * closed term: the new enrollment names the one it came from, and what was owed is carried into it as one ledger entry.
 * A student's outcome is read back from that, never stored on the closed enrollment.
 */

const sectionFilter = (sections: "all" | readonly string[]): string | null => (sections === "all" ? null : JSON.stringify(sections));

const CLASS_NAME = (cl: string, lv: string, pv: string) => `${pv}.name || ' · ' || ${lv}.name || CASE WHEN ${cl}.label <> '' THEN ' (' || ${cl}.label || ')' ELSE '' END`;

/** The next switched-on level of the same programme, for a level alias `l`: its id, or null at the last level. */
const NEXT_LEVEL = (l: string) =>
  `(SELECT x.id FROM levels x WHERE x.programme_id = ${l}.programme_id AND x.is_active = 1 AND x.ordinal > ${l}.ordinal ORDER BY x.ordinal LIMIT 1)`;

interface StudentRow {
  class_id: string;
  class_name: string;
  level_id: string;
  next_level_id: string | null;
  next_level_name: string | null;
  enrollment_id: string;
  student_id: string;
  sid: string;
  name: string;
  roll_no: number | null;
  student_status: "active" | "left" | "graduated";
  moved_class: string | null;
  moved_same_level: number | null;
}

/**
 * The board for one closed term (or, with none asked for, the most recently closed term that still has students to
 * move): its classes in the person's sections with their students and where each has gone, and the open terms' classes
 * they can go to. Two round trips: the board, then the balances.
 */
export async function promotionBoard(db: D1Database, sections: "all" | readonly string[], termId: string | null): Promise<PromotionBoard> {
  const filter = sectionFilter(sections);
  const PENDING = `EXISTS (SELECT 1 FROM enrollments pe JOIN students ps ON ps.id = pe.student_id
                            WHERE pe.academic_year_id = ay.id AND pe.status = 'active' AND ps.status = 'active'
                              AND NOT EXISTS (SELECT 1 FROM enrollments nx WHERE nx.previous_enrollment_id = pe.id))`;
  const [termRows, chosenRows] = await db.batch([
    db.prepare(`SELECT ay.public_id AS id, ay.label, ${PENDING} AS pending FROM academic_years ay WHERE ay.status = 'closed' ORDER BY ay.closed_at DESC, ay.id DESC`),
    db
      .prepare(
        `SELECT ay.public_id AS id FROM academic_years ay
          WHERE ay.status = 'closed' AND (ay.public_id = ?1 OR (?1 IS NULL AND ${PENDING}))
          ORDER BY ay.closed_at DESC, ay.id DESC LIMIT 1`,
      )
      .bind(termId),
  ]);
  const terms = (termRows!.results as unknown as { id: string; label: string; pending: number }[]).map((t) => ({ id: t.id, label: t.label, pending: t.pending === 1 }));
  const chosen = (chosenRows!.results[0] as { id: string } | undefined)?.id ?? null;
  if (!chosen) return { terms, termId: null, classes: [], targets: [] };

  const [studentRows, targetRows] = await db.batch([
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${CLASS_NAME("cl", "lv", "pv")} AS class_name, lv.public_id AS level_id,
                nl.public_id AS next_level_id, nl.name AS next_level_name,
                en.public_id AS enrollment_id, st.public_id AS student_id, st.sid, st.first_name || ' ' || st.last_name AS name, en.roll_no,
                st.status AS student_status,
                ${CLASS_NAME("mc", "ml", "mp")} AS moved_class, (mc.level_id = cl.level_id) AS moved_same_level
           FROM academic_years ay JOIN classes cl ON cl.academic_year_id = ay.id
           JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
           LEFT JOIN levels nl ON nl.id = ${NEXT_LEVEL("lv")}
           JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
           LEFT JOIN enrollments me ON me.previous_enrollment_id = en.id
           LEFT JOIN classes mc ON mc.id = me.class_id LEFT JOIN levels ml ON ml.id = mc.level_id LEFT JOIN programmes mp ON mp.id = ml.programme_id
          WHERE ay.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))
          ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, en.roll_no, st.first_name, st.last_name`,
      )
      .bind(chosen, filter),
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${CLASS_NAME("cl", "lv", "pv")} AS class_name, lv.public_id AS level_id, ay.label AS term_label
           FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status <> 'closed'
           JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
          WHERE cl.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
          ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label`,
      )
      .bind(filter),
  ]);
  const rows = studentRows!.results as unknown as StudentRow[];
  const balances = await enrollmentBalances(
    db,
    rows.map((r) => r.enrollment_id),
  );

  const classes: PromotionBoard["classes"] = [];
  for (const r of rows) {
    let entry = classes[classes.length - 1];
    if (!entry || entry.classId !== r.class_id) {
      classes.push((entry = { classId: r.class_id, className: r.class_name, levelId: r.level_id, nextLevelId: r.next_level_id, nextLevelName: r.next_level_name, students: [] }));
    }
    const outcome = r.moved_class !== null ? (r.moved_same_level === 1 ? "repeated" : "promoted") : r.student_status === "active" ? "pending" : r.student_status;
    entry.students.push({
      enrollmentId: r.enrollment_id,
      studentId: r.student_id,
      sid: r.sid,
      name: r.name,
      rollNo: r.roll_no,
      balancePaisa: balances.get(r.enrollment_id) ?? 0,
      outcome,
      movedTo: r.moved_class,
    });
  }
  return {
    terms,
    termId: chosen,
    classes,
    targets: (targetRows!.results as unknown as { class_id: string; class_name: string; level_id: string; term_label: string }[]).map((t) => ({
      classId: t.class_id,
      className: t.class_name,
      levelId: t.level_id,
      termLabel: t.term_label,
    })),
  };
}

interface FromRow {
  enrollment_id: string;
  term_closed: number;
  student_active: number;
  moved: number;
  moved_to: string | null;
  moved_term_start: string | null;
  level_id: number;
  next_level_id: number | null;
  allowed: number;
}

interface ToRow {
  class_id: string;
  level_id: number;
  term_open: number;
  term_start: string;
  allowed: number;
}

/**
 * Moves students, each on its own (one student's problem never stops the others). Every write re-checks, inside its own
 * statement, what was read first: the old term is closed, the student has not moved, the target fits, the Co-ordinator
 * reaches both classes. A repeat of the same move finds it already made.
 */
export async function moveStudents(db: D1Database, key: string, actor: string, moves: readonly MoveInput[], now: Date = new Date()): Promise<MoveResult[]> {
  const fromIds = [...new Set(moves.map((m) => m.enrollmentId))];
  const toIds = [...new Set(moves.flatMap((m) => (m.classId ? [m.classId] : [])))];
  const [fromRows, toRows] = await db.batch([
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, (ay.status = 'closed') AS term_closed, (st.status = 'active') AS student_active,
                EXISTS (SELECT 1 FROM enrollments nx WHERE nx.previous_enrollment_id = en.id) AS moved,
                (SELECT nx.public_id FROM enrollments nx WHERE nx.previous_enrollment_id = en.id) AS moved_to,
                (SELECT ny.start_date FROM enrollments nx JOIN academic_years ny ON ny.id = nx.academic_year_id WHERE nx.previous_enrollment_id = en.id) AS moved_term_start,
                lv.id AS level_id, ${NEXT_LEVEL("lv")} AS next_level_id, ${coordinatorForSection(2, "pv.section_id")} AS allowed
           FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id JOIN students st ON st.id = en.student_id
           JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
          WHERE en.public_id IN (SELECT value FROM json_each(?1)) AND en.status = 'active'`,
      )
      .bind(JSON.stringify(fromIds), actor),
    db
      .prepare(
        `SELECT cl.public_id AS class_id, cl.level_id, (ay.status <> 'closed' AND cl.is_active = 1) AS term_open, ay.start_date AS term_start,
                ${coordinatorForSection(2, "pv.section_id")} AS allowed
           FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
          WHERE cl.public_id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(toIds), actor),
  ]);
  const from = new Map((fromRows!.results as unknown as FromRow[]).map((r) => [r.enrollment_id, r]));
  const to = new Map((toRows!.results as unknown as ToRow[]).map((r) => [r.class_id, r]));
  const balances = await enrollmentBalances(db, fromIds);
  const at = now.toISOString();
  const today = nepalDate(now);

  const results: MoveResult[] = [];
  for (const move of moves) {
    const old = from.get(move.enrollmentId);
    const fail = (reason: MoveResult["reason"], message?: string) => results.push({ enrollmentId: move.enrollmentId, ok: false, reason, ...(message ? { message } : {}) });
    if (!old || old.allowed !== 1) {
      fail("not_found");
      continue;
    }
    if (old.term_closed !== 1) {
      fail("invalid", "The Principal closes the term before its students move on");
      continue;
    }
    if (old.moved === 1 && old.moved_to) {
      // Already moved. If carrying the dues failed after the move was written, this finishes it (carrying happens once).
      await carryDues(db, key, actor, move.enrollmentId, old.moved_to, old.moved_term_start! > today ? old.moved_term_start! : today);
      fail("already_moved");
      continue;
    }
    if (old.student_active !== 1) {
      fail("already_moved");
      continue;
    }

    if (move.action === "leave" || move.action === "graduate") {
      if (move.action === "graduate" && old.next_level_id !== null) {
        fail("invalid", "Only a student at the last level graduates");
        continue;
      }
      if ((balances.get(move.enrollmentId) ?? 0) > 0) {
        fail("has_dues", "A student leaves or graduates only with nothing owed");
        continue;
      }
      const status = move.action === "graduate" ? "graduated" : "left";
      const { applied } = await recordAudit(
        db,
        key,
        { action: `students.${status}`, entityType: "enrollment", entityPublicId: move.enrollmentId, actorPublicId: actor, summary: status === "graduated" ? "Student graduated" : "Student left" },
        [
          db
            .prepare(
              `UPDATE students SET status = ?3
                WHERE id = (SELECT en.student_id FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id JOIN classes cl ON cl.id = en.class_id
                             JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
                            WHERE en.public_id = ?1 AND ay.status = 'closed' AND ${coordinatorForSection(2, "pv.section_id")}
                              AND NOT EXISTS (SELECT 1 FROM enrollments nx WHERE nx.previous_enrollment_id = en.id)
                              AND (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = en.id) <= 0)
                  AND status = 'active'`,
            )
            .bind(move.enrollmentId, actor, status),
        ],
        { onlyIfLastChanged: true },
      );
      results.push(applied ? { enrollmentId: move.enrollmentId, ok: true } : { enrollmentId: move.enrollmentId, ok: false, reason: "already_moved" });
      continue;
    }

    // Promote or repeat: into a class of the next level, or of the same level, in an open term.
    const target = move.classId ? to.get(move.classId) : undefined;
    if (!target || target.allowed !== 1) {
      fail("invalid", "Choose a class in an open term");
      continue;
    }
    if (target.term_open !== 1) {
      fail("invalid", "That class is not in an open term");
      continue;
    }
    const wanted = move.action === "promote" ? old.next_level_id : old.level_id;
    if (wanted === null) {
      fail("invalid", "This is the last level: graduate the student instead");
      continue;
    }
    if (target.level_id !== wanted) {
      fail("invalid", move.action === "promote" ? "Choose a class of the next level" : "Choose a class of the same level");
      continue;
    }

    const newEnrollment = newPublicId();
    let applied = false;
    try {
      ({ applied } = await recordAudit(
        db,
        key,
        {
          action: move.action === "promote" ? "students.promoted" : "students.repeated",
          entityType: "enrollment",
          entityPublicId: newEnrollment,
          actorPublicId: actor,
          summary: move.action === "promote" ? "Student promoted into the next term" : "Student repeats the level in the next term",
          after: { from: move.enrollmentId, classId: move.classId },
        },
        [
          db
            .prepare(
              `INSERT INTO enrollments (public_id, student_id, academic_year_id, class_id, status, created_at, previous_enrollment_id)
               SELECT ?1, en.student_id, cl.academic_year_id, cl.id, 'active', ?4, en.id
                 FROM enrollments en JOIN academic_years oy ON oy.id = en.academic_year_id AND oy.status = 'closed'
                 JOIN classes oc ON oc.id = en.class_id JOIN levels ol ON ol.id = oc.level_id JOIN programmes op ON op.id = ol.programme_id
                 JOIN students st ON st.id = en.student_id AND st.status = 'active'
                 JOIN classes cl ON cl.public_id = ?3 AND cl.is_active = 1 JOIN academic_years ny ON ny.id = cl.academic_year_id AND ny.status <> 'closed'
                 JOIN levels nl ON nl.id = cl.level_id JOIN programmes np ON np.id = nl.programme_id
                WHERE en.public_id = ?2 AND en.status = 'active'
                  AND cl.level_id = ${move.action === "promote" ? NEXT_LEVEL("ol") : "ol.id"}
                  AND ${coordinatorForSection(5, "op.section_id")} AND ${coordinatorForSection(5, "np.section_id")}`,
            )
            .bind(newEnrollment, move.enrollmentId, move.classId, at, actor),
        ],
        { onlyIfLastChanged: true },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE constraint failed/i.test(message)) throw error;
      // Already moved (a second click), or already has a class in that term.
      fail(/previous_enrollment_id/i.test(message) ? "already_moved" : "conflict", /previous_enrollment_id/i.test(message) ? undefined : "The student already has a class in that term");
      continue;
    }
    if (!applied) {
      fail("already_moved");
      continue;
    }
    const dueOn = target.term_start > today ? target.term_start : today;
    const carried = await carryDues(db, key, actor, move.enrollmentId, newEnrollment, dueOn);
    results.push({ enrollmentId: move.enrollmentId, ok: true, newEnrollmentId: newEnrollment, carriedDues: carried === "carried" });
  }
  return results;
}
