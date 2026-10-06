import { newPublicId } from "../../core/ids";
import { adminForProgrammes } from "./guard";
import {
  CreateLevelSchema,
  CreateProgrammeSchema,
  LevelChangesSchema,
  ProgrammeChangesSchema,
  type LevelChanges,
  type LevelInput,
  type ProgrammeChanges,
  type ProgrammeInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

interface ProgrammeRow {
  name: string;
  affiliation: string;
  is_active: number;
}

/** One round trip: may the person act on this programme's section, and what is the programme now? */
async function inspectProgramme(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${adminForProgrammes(1)} AS ok`).bind(actor),
    db.prepare("SELECT name, affiliation, is_active FROM programmes WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    programme: (row!.results[0] as unknown as ProgrammeRow | undefined) ?? null,
  };
}

/** Adds a programme to a section. The key is generated: pack programmes keep the key the pack gave them. */
export async function createProgramme(db: D1Database, auditKey: string, actor: string, input: ProgrammeInput): Promise<Created> {
  const parsed = CreateProgrammeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;

  const publicId = newPublicId();
  const key = `p${publicId.slice(0, 10)}`;
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.programme.created",
      entityType: "programme",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Programme "${p.name}" added`,
      after: p,
    },
    db
      .prepare(
        `INSERT INTO programmes (public_id, key, name, section_id, affiliation, ordering)
         SELECT ?1, ?2, ?3, s.id, ?5, COALESCE((SELECT MAX(ordering) FROM programmes), 0) + 1
           FROM sections s
          WHERE s.key = ?4 AND s.is_active = 1 AND ${adminForProgrammes(6)}`,
      )
      .bind(publicId, key, p.name, p.sectionKey, p.affiliation, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  const section = await db.prepare("SELECT is_active FROM sections WHERE key = ?1").bind(p.sectionKey).first<{ is_active: number }>();
  if (!section) return { ok: false, reason: "not_found" };
  // A switched-off section takes no new programmes (D-097).
  return section.is_active === 1 ? { ok: false, reason: "not_allowed" } : { ok: false, reason: "invalid", message: "That section is switched off. Switch it on to add programmes to it." };
}

/**
 * Renames a programme, changes its affiliation, or switches it off and on. Nothing is deleted. (Grading is the term's
 * exam pattern since D-117, not the programme's.)
 */
export async function updateProgramme(db: D1Database, auditKey: string, actor: string, publicId: string, changes: ProgrammeChanges): Promise<Done> {
  const parsed = ProgrammeChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, programme } = await inspectProgramme(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!programme) return { ok: false, reason: "not_found" };

  const before = { name: programme.name, affiliation: programme.affiliation, active: programme.is_active === 1 };
  const after = {
    name: c.name ?? before.name,
    affiliation: c.affiliation ?? before.affiliation,
    active: c.active ?? before.active,
  };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.programme.updated",
      entityType: "programme",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Programme "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(
        `UPDATE programmes SET name = ?2, affiliation = ?3, is_active = ?4
          WHERE public_id = ?1 AND ${adminForProgrammes(5)}`,
      )
      .bind(publicId, after.name, after.affiliation, after.active ? 1 : 0, actor),
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_allowed" };
}

/** Adds a level to a programme, numbered after the last one. Two added at once get different numbers. */
export async function addLevel(db: D1Database, auditKey: string, actor: string, programmeId: string, input: LevelInput): Promise<Created> {
  const parsed = CreateLevelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.level.created",
      entityType: "level",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Level "${parsed.data.name}" added`,
      after: { programmeId, name: parsed.data.name, usualMonths: parsed.data.usualMonths ?? null },
    },
    db
      .prepare(
        `INSERT INTO levels (public_id, programme_id, ordinal, name, usual_months)
         SELECT ?1, p.id, COALESCE((SELECT MAX(ordinal) FROM levels WHERE programme_id = p.id), 0) + 1, ?3, ?5
           FROM programmes p
          WHERE p.public_id = ?2 AND p.is_active = 1 AND ${adminForProgrammes(4)}`,
      )
      .bind(publicId, programmeId, parsed.data.name, actor, parsed.data.usualMonths ?? null),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "A programme can have at most 20 levels" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };

  const { allowed, programme } = await inspectProgramme(db, programmeId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!programme) return { ok: false, reason: "not_found" };
  if (programme.is_active === 0) return { ok: false, reason: "invalid", message: "That programme is switched off" };
  return { ok: false, reason: "not_allowed" };
}

interface LevelRow {
  name: string;
  is_active: number;
  usual_months: number | null;
}

async function inspectLevel(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db
      .prepare(
        `SELECT ${adminForProgrammes(1)} AS ok`,
      )
      .bind(actor),
    db.prepare("SELECT name, is_active, usual_months FROM levels WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    level: (row!.results[0] as unknown as LevelRow | undefined) ?? null,
  };
}

/** Renames a level or switches it off and on. Nothing is deleted. */
export async function updateLevel(db: D1Database, auditKey: string, actor: string, publicId: string, changes: LevelChanges): Promise<Done> {
  const parsed = LevelChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, level } = await inspectLevel(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!level) return { ok: false, reason: "not_found" };

  const before = { name: level.name, active: level.is_active === 1, usualMonths: level.usual_months };
  const after = { name: c.name ?? before.name, active: c.active ?? before.active, usualMonths: c.usualMonths === undefined ? before.usualMonths : c.usualMonths };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.level.updated",
      entityType: "level",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Level "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(
        `UPDATE levels SET name = ?2, is_active = ?3, usual_months = ?5
          WHERE public_id = ?1 AND ${adminForProgrammes(4)}`,
      )
      .bind(publicId, after.name, after.active ? 1 : 0, actor, after.usualMonths),
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_allowed" };
}
