import { adminForProgrammes } from "./guard";
import { LEVEL_FREE, PROGRAMME_FREE, SECTION_FREE } from "./queries";
import { write, type Done } from "./write";

/**
 * Deleting a section, programme or level (D-097, the PM 2026-10-01): allowed only while NOTHING is attached to it. A
 * section with a programme, a programme with a level, a level with a class (and so on down to the students) cannot be
 * deleted; it can only be switched off, which keeps its history. This is the one exception to "no hard deletes"
 * (CLAUDE.md section 6), for structure set up by mistake and never used.
 *
 * Each delete re-checks the Admin and "nothing attached" inside its own statement, so a class added a moment earlier
 * makes it fail, never leaves the class pointing nowhere; the foreign keys refuse it too. The audit entry keeps what
 * was deleted, in the same batch.
 */

type Kind = "section" | "programme" | "level";

const TABLE: Record<Kind, { table: string; idColumn: string; free: (alias: string) => string; label: string }> = {
  section: { table: "sections", idColumn: "key", free: SECTION_FREE, label: "Section" },
  programme: { table: "programmes", idColumn: "public_id", free: PROGRAMME_FREE, label: "Programme" },
  level: { table: "levels", idColumn: "public_id", free: LEVEL_FREE, label: "Level" },
};

async function remove(db: D1Database, auditKey: string, actor: string, kind: Kind, id: string): Promise<Done> {
  const { table, idColumn, free, label } = TABLE[kind];
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${adminForProgrammes(1)} AS ok`).bind(actor),
    db.prepare(`SELECT t.name, ${free("t")} AS free FROM ${table} t WHERE t.${idColumn} = ?1`).bind(id),
  ]);
  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  const current = row!.results[0] as { name: string; free: number } | undefined;
  if (!current) return { ok: false, reason: "not_found" };
  if (current.free !== 1) return { ok: false, reason: "in_use" };

  const outcome = await write(
    db,
    auditKey,
    { action: `academics.${kind}.deleted`, entityType: kind, entityPublicId: id, actorPublicId: actor, summary: `${label} "${current.name}" deleted`, before: { name: current.name } },
    db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?1 AND ${adminForProgrammes(2)} AND ${free(table)}`).bind(id, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "in_use" }; // a foreign key still points at it
  // Nothing was deleted: something was attached a moment ago, it is already gone, or the person was switched off.
  const still = await db.prepare(`SELECT ${free("t")} AS free FROM ${table} t WHERE t.${idColumn} = ?1`).bind(id).first<{ free: number }>();
  return { ok: false, reason: !still ? "not_found" : still.free !== 1 ? "in_use" : "not_allowed" };
}

export const deleteSection = (db: D1Database, auditKey: string, actor: string, key: string) => remove(db, auditKey, actor, "section", key);
export const deleteProgramme = (db: D1Database, auditKey: string, actor: string, publicId: string) => remove(db, auditKey, actor, "programme", publicId);
export const deleteLevel = (db: D1Database, auditKey: string, actor: string, publicId: string) => remove(db, auditKey, actor, "level", publicId);
