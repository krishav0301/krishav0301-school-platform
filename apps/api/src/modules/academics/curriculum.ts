import { newPublicId } from "../../core/ids";
import { coordinatorForSection, groupSection, levelSection, offeringSection } from "./guard";
import {
  CreateGroupSchema,
  CreateOfferingSchema,
  GroupChangesSchema,
  OfferingChangesSchema,
  type GroupChanges,
  type GroupInput,
  type OfferingChanges,
  type OfferingInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/**
 * What each programme level teaches (D-058): elective groups and subject offerings, each with its paper's full marks
 * and, when it has one, its practical's share (D-114; this replaced the free list of mark components). Every write is
 * limited to a Co-ordinator whose scope covers the level's section (or the Super Admin), re-checked in the write's own
 * SQL. Nothing is deleted: things are switched off. Marks and credit hours are whole hundredths.
 */

type Row = Record<string, unknown> | undefined;

/**
 * One round trip: may the person act on the section of the thing named by `publicId` (`sectionOf` is one of the guard's
 * section helpers, reading the public id as ?2), and what do the extra reads say? Each extra read gets its row back.
 */
async function look(db: D1Database, actor: string, sectionOf: string, publicId: string, ...reads: D1PreparedStatement[]) {
  const results = await db.batch([db.prepare(`SELECT ${coordinatorForSection(1, sectionOf)} AS ok`).bind(actor, publicId), ...reads]);
  return {
    allowed: (results[0]!.results[0] as { ok: number } | undefined)?.ok === 1,
    rows: results.slice(1).map((r) => r.results[0] as Row),
  };
}

const levelState = (db: D1Database, levelId: string) =>
  db.prepare("SELECT l.is_active AS level_active, p.is_active AS programme_active FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?1").bind(levelId);
const groupState = (db: D1Database, groupId: string) =>
  db.prepare("SELECT g.is_active AS active, l.public_id AS level FROM elective_groups g JOIN levels l ON l.id = g.level_id WHERE g.public_id = ?1").bind(groupId);
const switchedOff = (row: Row) => row!.level_active === 0 || row!.programme_active === 0;

// --- Elective groups ---------------------------------------------------------------------------------

/** Adds an elective group to a level ("pick one of these"). A student's own pick is saved when students exist. */
export async function createGroup(db: D1Database, auditKey: string, actor: string, levelId: string, input: GroupInput): Promise<Created> {
  const parsed = CreateGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const group = { name: parsed.data.name, pickCount: parsed.data.pickCount ?? 1 };

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.group.created",
      entityType: "elective_group",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Elective group "${group.name}" added`,
      after: { levelId, ...group },
    },
    db
      .prepare(
        `INSERT INTO elective_groups (public_id, level_id, name, pick_count)
         SELECT ?1, l.id, ?3, ?4
           FROM levels l JOIN programmes p ON p.id = l.programme_id
          WHERE l.public_id = ?2 AND l.is_active = 1 AND p.is_active = 1 AND ${coordinatorForSection(5, "p.section_id")}`,
      )
      .bind(publicId, levelId, group.name, group.pickCount, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };

  const { allowed, rows } = await look(db, actor, levelSection(2), levelId, levelState(db, levelId));
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if (switchedOff(rows[0])) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  return { ok: false, reason: "not_allowed" };
}

/** Renames a group, changes how many are picked, or switches it off and on. */
export async function updateGroup(db: D1Database, auditKey: string, actor: string, publicId: string, changes: GroupChanges): Promise<Done> {
  const parsed = GroupChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, rows } = await look(db, actor, groupSection(2), publicId, db.prepare("SELECT name, pick_count, is_active FROM elective_groups WHERE public_id = ?1").bind(publicId));
  if (!allowed) return { ok: false, reason: "not_allowed" };
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };

  const before = { name: row.name as string, pickCount: row.pick_count as number, active: row.is_active === 1 };
  const after = { name: c.name ?? before.name, pickCount: c.pickCount ?? before.pickCount, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.group.updated",
      entityType: "elective_group",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Elective group "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(`UPDATE elective_groups SET name = ?2, pick_count = ?3, is_active = ?4 WHERE public_id = ?1 AND ${coordinatorForSection(5, groupSection(1))}`)
      .bind(publicId, after.name, after.pickCount, after.active ? 1 : 0, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}

// --- Subject offerings -------------------------------------------------------------------------------

/**
 * Adds a subject to a programme level, optionally with credit hours and an elective group of the SAME level. An archived
 * subject, a switched-off level, programme or group cannot be used. The group is checked in the SQL as well as by the
 * database's own composite foreign key, so a group of another level never sticks and is never silently dropped.
 */
export async function createOffering(db: D1Database, auditKey: string, actor: string, input: OfferingInput): Promise<Created> {
  const parsed = CreateOfferingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const o = {
    levelId: parsed.data.levelId,
    subjectId: parsed.data.subjectId,
    creditHundredths: parsed.data.creditHundredths ?? null,
    groupId: parsed.data.groupId ?? null,
    fullMarksHundredths: parsed.data.fullMarksHundredths ?? 10_000,
    practicalHundredths: parsed.data.practicalHundredths ?? null,
  };

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.offering.created",
      entityType: "subject_offering",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: "Subject added to a level",
      after: o,
    },
    db
      .prepare(
        `INSERT INTO subject_offerings (public_id, level_id, subject_id, credit_hundredths, elective_group_id, full_marks_hundredths, practical_hundredths)
         SELECT ?1, l.id, s.id, ?4, (SELECT g.id FROM elective_groups g WHERE g.public_id = ?5), ?7, ?8
           FROM levels l
           JOIN programmes p ON p.id = l.programme_id
           CROSS JOIN subjects s
          WHERE l.public_id = ?2 AND s.public_id = ?3
            AND l.is_active = 1 AND p.is_active = 1 AND s.is_archived = 0
            AND (?5 IS NULL OR EXISTS (SELECT 1 FROM elective_groups g2 WHERE g2.public_id = ?5 AND g2.level_id = l.id AND g2.is_active = 1))
            AND ${coordinatorForSection(6, "p.section_id")}`,
      )
      .bind(publicId, o.levelId, o.subjectId, o.creditHundredths, o.groupId, actor, o.fullMarksHundredths, o.practicalHundredths),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };

  const { allowed, rows } = await look(
    db,
    actor,
    levelSection(2),
    o.levelId,
    levelState(db, o.levelId),
    db.prepare("SELECT is_archived FROM subjects WHERE public_id = ?1").bind(o.subjectId),
    groupState(db, o.groupId ?? ""),
  );
  const [level, subject, group] = rows;
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!level || !subject) return { ok: false, reason: "not_found" };
  if (switchedOff(level)) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  if (subject.is_archived === 1) return { ok: false, reason: "invalid", message: "That subject is archived" };
  if (o.groupId !== null && (!group || group.level !== o.levelId || group.active === 0)) {
    return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };
  }
  return { ok: false, reason: "not_allowed" };
}

/**
 * Changes an offering's credit hours (or takes them away), its paper (full marks, and the practical's share or none),
 * moves it to another group of its level (or out of its group), or switches it off and on. A new paper applies to mark
 * sheets made from now on: a sheet keeps the maxima it was made with (D-114).
 */
export async function updateOffering(db: D1Database, auditKey: string, actor: string, publicId: string, changes: OfferingChanges): Promise<Done> {
  const parsed = OfferingChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, rows } = await look(
    db,
    actor,
    offeringSection(2),
    publicId,
    db
      .prepare(
        `SELECT o.credit_hundredths AS credit, o.is_active AS active, l.public_id AS level, g.public_id AS grp, o.full_marks_hundredths AS full_marks, o.practical_hundredths AS practical
           FROM subject_offerings o JOIN levels l ON l.id = o.level_id LEFT JOIN elective_groups g ON g.id = o.elective_group_id
          WHERE o.public_id = ?1`,
      )
      .bind(publicId),
    groupState(db, c.groupId ?? ""),
  );
  if (!allowed) return { ok: false, reason: "not_allowed" };
  const [row, newGroup] = rows;
  if (!row) return { ok: false, reason: "not_found" };

  const before = {
    creditHundredths: row.credit as number | null,
    groupId: row.grp as string | null,
    active: row.active === 1,
    fullMarksHundredths: row.full_marks as number,
    practicalHundredths: row.practical as number | null,
  };
  const after = {
    creditHundredths: c.creditHundredths === undefined ? before.creditHundredths : c.creditHundredths,
    groupId: c.groupId === undefined ? before.groupId : c.groupId,
    active: c.active ?? before.active,
    fullMarksHundredths: c.fullMarksHundredths ?? before.fullMarksHundredths,
    practicalHundredths: c.practicalHundredths === undefined ? before.practicalHundredths : c.practicalHundredths,
  };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };
  if (after.practicalHundredths !== null && after.practicalHundredths >= after.fullMarksHundredths) {
    return { ok: false, reason: "invalid", message: "The practical must be less than the full marks" };
  }
  if (after.groupId !== null && after.groupId !== before.groupId && (!newGroup || newGroup.level !== row.level || newGroup.active === 0)) {
    return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };
  }

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.offering.updated",
      entityType: "subject_offering",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: "Subject on a level changed",
      before,
      after,
    },
    db
      .prepare(
        `UPDATE subject_offerings
            SET credit_hundredths = ?2, elective_group_id = (SELECT g.id FROM elective_groups g WHERE g.public_id = ?3), is_active = ?4,
                full_marks_hundredths = ?6, practical_hundredths = ?7
          WHERE public_id = ?1
            AND (?3 IS NULL OR EXISTS (SELECT 1 FROM elective_groups g2 WHERE g2.public_id = ?3 AND g2.level_id = subject_offerings.level_id))
            AND ${coordinatorForSection(5, offeringSection(1))}`,
      )
      .bind(publicId, after.creditHundredths, after.groupId, after.active ? 1 : 0, actor, after.fullMarksHundredths, after.practicalHundredths),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };
  return { ok: false, reason: "not_allowed" };
}
