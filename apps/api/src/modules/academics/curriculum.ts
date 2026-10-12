import { newPublicId } from "../../core/ids";
import { coordinatorForSection, groupSection, levelSection, offeringSection } from "./guard";
import { GROUP_FREE, OFFERING_FREE } from "./queries";
import {
  CopyOfferingsSchema,
  CreateGroupSchema,
  CreateOfferingSchema,
  GroupChangesSchema,
  OfferingChangesSchema,
  passMarksFit,
  type CopyOfferingsInput,
  type GroupChanges,
  type GroupInput,
  type OfferingChanges,
  type OfferingInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/**
 * What each programme level teaches (D-058): elective groups and subject offerings, each with its paper's full marks
 * and, when it has one, its practical's share (D-117; this replaced the free list of mark components). Every write is
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
    passTheoryHundredths: parsed.data.passTheoryHundredths ?? null,
    passPracticalHundredths: parsed.data.passPracticalHundredths ?? null,
  };
  const passProblem = passMarksFit(o);
  if (passProblem) return { ok: false, reason: "invalid", message: passProblem };

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
        `INSERT INTO subject_offerings (public_id, level_id, subject_id, credit_hundredths, elective_group_id, full_marks_hundredths, practical_hundredths, pass_theory_hundredths, pass_practical_hundredths)
         SELECT ?1, l.id, s.id, ?4, (SELECT g.id FROM elective_groups g WHERE g.public_id = ?5), ?7, ?8, ?9, ?10
           FROM levels l
           JOIN programmes p ON p.id = l.programme_id
           CROSS JOIN subjects s
          WHERE l.public_id = ?2 AND s.public_id = ?3
            AND l.is_active = 1 AND p.is_active = 1 AND s.is_archived = 0
            AND s.section_id = p.section_id
            AND (?5 IS NULL OR EXISTS (SELECT 1 FROM elective_groups g2 WHERE g2.public_id = ?5 AND g2.level_id = l.id AND g2.is_active = 1))
            AND ${coordinatorForSection(6, "p.section_id")}`,
      )
      .bind(publicId, o.levelId, o.subjectId, o.creditHundredths, o.groupId, actor, o.fullMarksHundredths, o.practicalHundredths, o.passTheoryHundredths, o.passPracticalHundredths),
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
    db.prepare("SELECT x.is_archived, x.section_id, (SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?2) AS level_section FROM subjects x WHERE x.public_id = ?1").bind(o.subjectId, o.levelId),
    groupState(db, o.groupId ?? ""),
  );
  const [level, subject, group] = rows;
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!level || !subject) return { ok: false, reason: "not_found" };
  if (switchedOff(level)) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  if (subject.is_archived === 1) return { ok: false, reason: "invalid", message: "That subject is archived" };
  // A level takes only a subject of its own wing (D-114).
  if (subject.section_id === null) return { ok: false, reason: "invalid", message: "Choose a wing for that subject first, on the Subjects page" };
  if (subject.section_id !== subject.level_section) return { ok: false, reason: "invalid", message: "That subject belongs to another wing" };
  if (o.groupId !== null && (!group || group.level !== o.levelId || group.active === 0)) {
    return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };
  }
  return { ok: false, reason: "not_allowed" };
}

/**
 * Changes an offering's credit hours (or takes them away), its paper (full marks, and the practical's share or none),
 * moves it to another group of its level (or out of its group), or switches it off and on. A new paper applies to mark
 * sheets made from now on: a sheet keeps the maxima it was made with (D-117).
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
        `SELECT o.credit_hundredths AS credit, o.is_active AS active, l.public_id AS level, g.public_id AS grp, o.full_marks_hundredths AS full_marks, o.practical_hundredths AS practical,
                o.pass_theory_hundredths AS pass_theory, o.pass_practical_hundredths AS pass_practical
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
    passTheoryHundredths: row.pass_theory as number | null,
    passPracticalHundredths: row.pass_practical as number | null,
  };
  const after = {
    creditHundredths: c.creditHundredths === undefined ? before.creditHundredths : c.creditHundredths,
    groupId: c.groupId === undefined ? before.groupId : c.groupId,
    active: c.active ?? before.active,
    fullMarksHundredths: c.fullMarksHundredths ?? before.fullMarksHundredths,
    practicalHundredths: c.practicalHundredths === undefined ? before.practicalHundredths : c.practicalHundredths,
    passTheoryHundredths: c.passTheoryHundredths === undefined ? before.passTheoryHundredths : c.passTheoryHundredths,
    // Taking the practical away takes its pass mark with it.
    passPracticalHundredths: c.practicalHundredths === null ? null : c.passPracticalHundredths === undefined ? before.passPracticalHundredths : c.passPracticalHundredths,
  };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };
  if (after.practicalHundredths !== null && after.practicalHundredths >= after.fullMarksHundredths) {
    return { ok: false, reason: "invalid", message: "The practical must be less than the full marks" };
  }
  const passProblem = passMarksFit(after);
  if (passProblem) return { ok: false, reason: "invalid", message: passProblem };
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
                full_marks_hundredths = ?6, practical_hundredths = ?7, pass_theory_hundredths = ?8, pass_practical_hundredths = ?9
          WHERE public_id = ?1
            AND (?3 IS NULL OR EXISTS (SELECT 1 FROM elective_groups g2 WHERE g2.public_id = ?3 AND g2.level_id = subject_offerings.level_id))
            AND ${coordinatorForSection(5, offeringSection(1))}`,
      )
      .bind(publicId, after.creditHundredths, after.groupId, after.active ? 1 : 0, actor, after.fullMarksHundredths, after.practicalHundredths, after.passTheoryHundredths, after.passPracticalHundredths),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That elective group is not available for this level" };
  return { ok: false, reason: "not_allowed" };
}

// --- Copying a level's subjects ------------------------------------------------------------------------

/** Both levels, the same programme, both on, a person who may act on its wing: the shared WHERE of the copy's statements. `lf` is the source, `lt` the target. */
const COPY_FROM = `FROM levels lf
         JOIN levels lt ON lt.programme_id = lf.programme_id AND lt.id <> lf.id
         JOIN programmes p ON p.id = lf.programme_id`;
const COPY_WHERE = `lf.public_id = ?1 AND lt.public_id = ?2 AND lf.is_active = 1 AND lt.is_active = 1 AND p.is_active = 1 AND ${coordinatorForSection(3, "p.section_id")}`;
/** The source's switched-on subjects (not archived) that the target does not have yet. */
const COPY_SUBJECTS = `JOIN subject_offerings o ON o.level_id = lf.id AND o.is_active = 1
         JOIN subjects s ON s.id = o.subject_id AND s.is_archived = 0 AND s.section_id = p.section_id`;
const NOT_YET_THERE = `NOT EXISTS (SELECT 1 FROM subject_offerings t WHERE t.level_id = lt.id AND t.subject_id = o.subject_id)`;

export type Copied = { ok: true; copied: number } | Extract<Done, { ok: false }>;

/**
 * Gives a level the subjects of another level of the SAME programme (R-001, the PM 2026-10-09): each switched-on subject
 * the level does not already have, with its credit hours, paper (full marks and practical) and elective group. A group
 * the target lacks is made, by name. Nothing the target already has is changed, and the source is untouched. One
 * all-or-nothing write with one audit entry; copying nothing writes nothing. Same permission as adding a subject.
 */
export async function copyOfferings(db: D1Database, auditKey: string, actor: string, input: CopyOfferingsInput): Promise<Copied> {
  const parsed = CopyOfferingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { fromLevelId, toLevelId } = parsed.data;
  if (fromLevelId === toLevelId) return { ok: false, reason: "invalid", message: "Choose another level to copy from" };

  const [allowed, levels, toCopy] = await db.batch([
    db.prepare(`SELECT ${coordinatorForSection(1, levelSection(2))} AS ok`).bind(actor, toLevelId),
    db
      .prepare(
        `SELECT l.public_id AS id, l.programme_id AS programme, l.is_active AS level_active, p.is_active AS programme_active
           FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id IN (?1, ?2)`,
      )
      .bind(fromLevelId, toLevelId),
    db.prepare(`SELECT COUNT(*) AS n ${COPY_FROM} ${COPY_SUBJECTS} WHERE ${COPY_WHERE} AND ${NOT_YET_THERE}`).bind(fromLevelId, toLevelId, actor),
  ]);
  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) {
    // Nobody may act on a level that is not there; say so only to a person who could have.
    return { ok: false, reason: "not_allowed" };
  }
  const rows = levels!.results as { id: string; programme: number; level_active: number; programme_active: number }[];
  const from = rows.find((r) => r.id === fromLevelId);
  const to = rows.find((r) => r.id === toLevelId);
  if (!from || !to) return { ok: false, reason: "not_found" };
  if (from.programme !== to.programme) return { ok: false, reason: "invalid", message: "Copy only between levels of the same programme" };
  if (!from.level_active || !to.level_active || !from.programme_active) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  const copied = (toCopy!.results[0] as { n: number }).n;
  if (copied === 0) return { ok: true, copied: 0 };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.offerings.copied",
      entityType: "level",
      entityPublicId: toLevelId,
      actorPublicId: actor,
      summary: `${copied} subject${copied === 1 ? "" : "s"} copied from another level`,
      after: { fromLevelId, toLevelId, copied },
    },
    [
      // Groups first (named after the source's), so the subjects can point at them. Only those a copied subject uses.
      db
        .prepare(
          `INSERT INTO elective_groups (public_id, level_id, name, pick_count)
           SELECT lower(hex(randomblob(16))), lt.id, g.name, g.pick_count
             ${COPY_FROM}
             JOIN elective_groups g ON g.level_id = lf.id
            WHERE ${COPY_WHERE}
              AND NOT EXISTS (SELECT 1 FROM elective_groups g2 WHERE g2.level_id = lt.id AND g2.name = g.name)
              AND EXISTS (SELECT 1 FROM subject_offerings o JOIN subjects s ON s.id = o.subject_id AND s.is_archived = 0 AND s.section_id = p.section_id
                           WHERE o.elective_group_id = g.id AND o.is_active = 1 AND ${NOT_YET_THERE})`,
        )
        .bind(fromLevelId, toLevelId, actor),
      // The subjects. The last statement: it decides whether the audit entry is written.
      db
        .prepare(
          `INSERT INTO subject_offerings (public_id, level_id, subject_id, credit_hundredths, elective_group_id, full_marks_hundredths, practical_hundredths, pass_theory_hundredths, pass_practical_hundredths)
           SELECT lower(hex(randomblob(16))), lt.id, o.subject_id, o.credit_hundredths,
                  (SELECT g2.id FROM elective_groups g2 JOIN elective_groups g ON g.id = o.elective_group_id WHERE g2.level_id = lt.id AND g2.name = g.name),
                  o.full_marks_hundredths, o.practical_hundredths, o.pass_theory_hundredths, o.pass_practical_hundredths
             ${COPY_FROM}
             ${COPY_SUBJECTS}
            WHERE ${COPY_WHERE} AND ${NOT_YET_THERE}`,
        )
        .bind(fromLevelId, toLevelId, actor),
    ],
  );
  if (outcome === "done") return { ok: true, copied };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" }; // someone added one a moment ago
  return { ok: false, reason: "not_allowed" };
}

// --- Deleting what was set up by mistake (the PM, 2026-10-12) -----------------------------------------

/**
 * Deletes a subject from a level, while nothing uses it: no teacher assigned, no note, homework, daily log, elective pick
 * or mark sheet. One that is used is switched off instead, which keeps its history. The Co-ordinator and "nothing uses it"
 * are re-checked inside the delete; the foreign keys refuse the rest. The audit entry keeps what was deleted.
 */
export async function deleteOffering(db: D1Database, auditKey: string, actor: string, publicId: string): Promise<Done> {
  const look = () =>
    db
      .prepare(
        `SELECT sb.name, l.name AS level_name, ${OFFERING_FREE("o")} AS free, ${coordinatorForSection(2, offeringSection(1))} AS allowed
           FROM subject_offerings o JOIN subjects sb ON sb.id = o.subject_id JOIN levels l ON l.id = o.level_id WHERE o.public_id = ?1`,
      )
      .bind(publicId, actor)
      .first<{ name: string; level_name: string; free: number; allowed: number }>();
  const row = await look();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.allowed !== 1) return { ok: false, reason: "not_allowed" };
  if (row.free !== 1) return { ok: false, reason: "in_use" };

  const outcome = await write(
    db,
    auditKey,
    { action: "academics.offering.deleted", entityType: "subject_offering", entityPublicId: publicId, actorPublicId: actor, summary: `Subject "${row.name}" removed from ${row.level_name}`, before: { subject: row.name, level: row.level_name } },
    db.prepare(`DELETE FROM subject_offerings WHERE public_id = ?1 AND ${coordinatorForSection(2, offeringSection(1))} AND ${OFFERING_FREE("subject_offerings")}`).bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "in_use" };
  const again = await look();
  if (!again) return { ok: false, reason: "not_found" };
  return { ok: false, reason: again.free !== 1 ? "in_use" : "not_allowed" };
}

/** Deletes an elective group with no subject in it. A group that still holds subjects is refused: move or delete them first. */
export async function deleteGroup(db: D1Database, auditKey: string, actor: string, publicId: string): Promise<Done> {
  const look = () =>
    db
      .prepare(`SELECT g.name, ${GROUP_FREE("g")} AS free, ${coordinatorForSection(2, groupSection(1))} AS allowed FROM elective_groups g WHERE g.public_id = ?1`)
      .bind(publicId, actor)
      .first<{ name: string; free: number; allowed: number }>();
  const row = await look();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.allowed !== 1) return { ok: false, reason: "not_allowed" };
  if (row.free !== 1) return { ok: false, reason: "in_use" };

  const outcome = await write(
    db,
    auditKey,
    { action: "academics.group.deleted", entityType: "elective_group", entityPublicId: publicId, actorPublicId: actor, summary: `Elective group "${row.name}" deleted`, before: { name: row.name } },
    db.prepare(`DELETE FROM elective_groups WHERE public_id = ?1 AND ${coordinatorForSection(2, groupSection(1))} AND ${GROUP_FREE("elective_groups")}`).bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "in_use" };
  const again = await look();
  if (!again) return { ok: false, reason: "not_found" };
  return { ok: false, reason: again.free !== 1 ? "in_use" : "not_allowed" };
}
