import { classSection, coordinatorForSection } from "./guard";
import type { RollNumbersResult } from "./schema";
import { write } from "./write";

/**
 * Roll numbers (the PM, 2026-10-29). Once the Co-ordinator has put a class's students in, one click gives every student who has
 * no roll number the next numbers, alphabetically by name (first name, then middle, then last; ties by date of birth, then by
 * the order they joined). A number once given is never changed or taken back: the next free number is always one past the
 * highest ever given in the class, so a student who leaves does not hand their number on. A student who joins a class that is
 * already numbered gets the next number at once (see `admissions`), whatever their name. Numbers belong to the enrolment, so a
 * new term's class starts with none and is numbered again.
 */

export type RollsDone = { ok: true; result: RollNumbersResult } | { ok: false; reason: "not_allowed" | "not_found" | "year_closed" | "nothing_to_give" };

/**
 * One statement: the new numbers are worked out first (both lists are materialised, so the update cannot move what it reads),
 * then written. The actor's reach is re-checked inside it from the database (D-021). Two clicks at once serialise: the second
 * finds nobody left without a number and changes nothing.
 */
const GIVE_NUMBERS = `
  WITH base AS MATERIALIZED (
    SELECT COALESCE(MAX(e.roll_no), 0) AS top FROM enrollments e WHERE e.class_id = (SELECT id FROM classes WHERE public_id = ?1)
  ), ranked AS MATERIALIZED (
    SELECT en.id AS id,
           ROW_NUMBER() OVER (ORDER BY st.first_name COLLATE NOCASE, COALESCE(st.middle_name, '') COLLATE NOCASE, st.last_name COLLATE NOCASE, st.dob_ad, en.id) AS n
      FROM enrollments en JOIN students st ON st.id = en.student_id
     WHERE en.class_id = (SELECT id FROM classes WHERE public_id = ?1) AND en.status = 'active' AND en.roll_no IS NULL
  )
  UPDATE enrollments SET roll_no = (SELECT base.top + ranked.n FROM base, ranked WHERE ranked.id = enrollments.id)
   WHERE id IN (SELECT id FROM ranked) AND ${coordinatorForSection(2, classSection(1))}`;

/** Gives every active student of the class who has no roll number the next numbers, alphabetically. */
export async function giveRollNumbers(db: D1Database, auditKey: string, actor: string, classId: string): Promise<RollsDone> {
  const before = await db
    .prepare(
      `SELECT (${coordinatorForSection(2, classSection(1))}) AS allowed,
              (SELECT COUNT(*) FROM classes cl JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' AND en.roll_no IS NULL WHERE cl.public_id = ?1) AS waiting,
              EXISTS (SELECT 1 FROM classes WHERE public_id = ?1) AS found`,
    )
    .bind(classId, actor)
    .first<{ allowed: number; waiting: number; found: number }>();
  if (!before || before.found !== 1) return { ok: false, reason: "not_found" };
  if (before.allowed !== 1) return { ok: false, reason: "not_allowed" };
  if (before.waiting === 0) return { ok: false, reason: "nothing_to_give" };

  const outcome = await write(
    db,
    auditKey,
    { action: "academics.roll_numbers.given", entityType: "class", entityPublicId: classId, actorPublicId: actor, summary: "Roll numbers given to a class's students", after: { students: before.waiting } },
    db.prepare(GIVE_NUMBERS).bind(classId, actor),
  );
  if (outcome === "done") return { ok: true, result: { numbered: before.waiting } };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  // Nothing changed: someone else numbered them first, or the actor's reach ended between the read and the write.
  return { ok: false, reason: "nothing_to_give" };
}
