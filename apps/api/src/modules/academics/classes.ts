import { newPublicId } from "../../core/ids";
import { coordinatorForSection } from "./guard";
import { CLASS_FREE } from "./queries";
import {
  ClassChangesSchema,
  CreateClassSchema,
  type ClassChanges,
  type ClassInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

// --- Classes -----------------------------------------------------------------------------------------

/** Why a new class was not made: one round trip to tell the person the truth. */
async function whyNoClass(db: D1Database, actor: string, yearId: string, levelId: string): Promise<Created> {
  const [allowed, year, level] = await db.batch([
    db
      .prepare(
        `SELECT ${coordinatorForSection(1, "(SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?2)")} AS ok`,
      )
      .bind(actor, levelId),
    db.prepare("SELECT status FROM academic_years WHERE public_id = ?1").bind(yearId),
    db
      .prepare("SELECT l.is_active AS level_active, p.is_active AS programme_active FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?1")
      .bind(levelId),
  ]);
  const yearRow = year!.results[0] as { status: string } | undefined;
  const levelRow = level!.results[0] as { level_active: number; programme_active: number } | undefined;

  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  if (!yearRow || !levelRow) return { ok: false, reason: "not_found" };
  if (yearRow.status === "closed") return { ok: false, reason: "year_closed" };
  if (levelRow.level_active === 0 || levelRow.programme_active === 0) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  return { ok: false, reason: "not_allowed" };
}

/** Makes a class: a level of a programme, in one year, with an optional label such as Morning. */
export async function createClass(db: D1Database, auditKey: string, actor: string, input: ClassInput): Promise<Created> {
  const parsed = CreateClassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.class.created",
      entityType: "class",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: c.label ? `Class added (${c.label})` : "Class added",
      after: c,
    },
    db
      .prepare(
        `INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label)
         SELECT ?1, y.id, l.programme_id, l.id, ?4
           FROM academic_years y
           CROSS JOIN levels l
           JOIN programmes p ON p.id = l.programme_id
          WHERE y.public_id = ?2 AND l.public_id = ?3
            AND y.status <> 'closed' AND l.is_active = 1 AND p.is_active = 1
            AND ${coordinatorForSection(5, "p.section_id")}`,
      )
      .bind(publicId, c.yearId, c.levelId, c.label, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "level_not_in_term") return { ok: false, reason: "invalid", message: "That level does not run in this term. The Principal adds a term's levels." };
  return whyNoClass(db, actor, c.yearId, c.levelId);
}

interface ClassRow {
  label: string;
  is_active: number;
  status: "draft" | "active" | "closed";
}

async function inspectClass(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db
      .prepare(
        `SELECT ${coordinatorForSection(1, "(SELECT p.section_id FROM classes c JOIN programmes p ON p.id = c.programme_id WHERE c.public_id = ?2)")} AS ok`,
      )
      .bind(actor, publicId),
    db.prepare("SELECT c.label, c.is_active, y.status FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    row: (row!.results[0] as unknown as ClassRow | undefined) ?? null,
  };
}

/** Relabels a class or switches it off and on. Nothing is deleted, and a closed year cannot be changed. */
export async function updateClass(db: D1Database, auditKey: string, actor: string, publicId: string, changes: ClassChanges): Promise<Done> {
  const parsed = ClassChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, row } = await inspectClass(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "closed") return { ok: false, reason: "year_closed" };

  const before = { label: row.label, active: row.is_active === 1 };
  const after = { label: c.label ?? before.label, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.class.updated",
      entityType: "class",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: "Class changed",
      before,
      after,
    },
    db
      .prepare(
        `UPDATE classes SET label = ?2, is_active = ?3
          WHERE public_id = ?1
            AND (SELECT status FROM academic_years WHERE id = classes.academic_year_id) <> 'closed'
            AND ${coordinatorForSection(4, "(SELECT section_id FROM programmes WHERE id = classes.programme_id)")}`,
      )
      .bind(publicId, after.label, after.active ? 1 : 0, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };

  const again = await inspectClass(db, publicId, actor);
  if (again.allowed && again.row?.status === "closed") return { ok: false, reason: "year_closed" };
  return { ok: false, reason: "not_allowed" };
}

/**
 * Deletes a class nothing is attached to (D-097): no student, teacher, activity, note, homework, mark sheet or result.
 * Otherwise it is switched off instead. A closed year cannot be changed, so its classes are never deleted.
 */
export async function deleteClass(db: D1Database, auditKey: string, actor: string, publicId: string): Promise<Done> {
  const { allowed, row } = await inspectClass(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "closed") return { ok: false, reason: "year_closed" };

  const outcome = await write(
    db,
    auditKey,
    { action: "academics.class.deleted", entityType: "class", entityPublicId: publicId, actorPublicId: actor, summary: "Class deleted", before: { label: row.label } },
    db
      .prepare(
        `DELETE FROM classes
          WHERE public_id = ?1 AND ${CLASS_FREE("classes")}
            AND ${coordinatorForSection(2, "(SELECT section_id FROM programmes WHERE id = classes.programme_id)")}`,
      )
      .bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "check_failed") return { ok: false, reason: "in_use" };
  const free = await db.prepare(`SELECT ${CLASS_FREE("c")} AS free FROM classes c WHERE c.public_id = ?1`).bind(publicId).first<{ free: number }>();
  return { ok: false, reason: !free ? "not_found" : free.free !== 1 ? "in_use" : "not_allowed" };
}
