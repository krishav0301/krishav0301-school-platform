import { newPublicId } from "../../core/ids";
import { adminForProgrammes } from "./guard";
import { CreateSectionSchema, SectionChangesSchema, type SectionChanges, type SectionInput } from "./schema";
import { firstMessage, write, type Done, type Failure } from "./write";

/**
 * Sections are the Admin's, like programmes (D-095): a school starts with none, and the Admin adds them ("Bachelor's",
 * "Master's", or "Primary", "High School") before adding the programmes under them. The key is generated and never
 * changes, because section scopes, receipt numbering and the Top 20 are keyed by it; only the name changes. A section is
 * never deleted (CLAUDE.md section 6), and two sections may not share a name, so nobody has to tell them apart by key.
 */

export type SectionCreated = { ok: true; key: string } | Failure;

export async function createSection(db: D1Database, auditKey: string, actor: string, input: SectionInput): Promise<SectionCreated> {
  const parsed = CreateSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { name } = parsed.data;

  const key = `s${newPublicId().slice(0, 10)}`;
  const outcome = await write(
    db,
    auditKey,
    { action: "academics.section.created", entityType: "section", entityPublicId: key, actorPublicId: actor, summary: `Section "${name}" added`, after: { name } },
    db
      .prepare(
        `INSERT INTO sections (key, name, ordering)
         SELECT ?1, ?2, COALESCE((SELECT MAX(ordering) FROM sections), -1) + 1
          WHERE ${adminForProgrammes(3)} AND NOT EXISTS (SELECT 1 FROM sections WHERE lower(name) = lower(?2))`,
      )
      .bind(key, name, actor),
  );
  if (outcome === "done") return { ok: true, key };
  return { ok: false, reason: (await sectionNamed(db, name)) ? "conflict" : "not_allowed" };
}

/** Renames a section, or switches it off and on (D-097). The key, and everything keyed by it, stays the same. */
export async function updateSection(db: D1Database, auditKey: string, actor: string, key: string, changes: SectionChanges): Promise<Done> {
  const parsed = SectionChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const [allowed, current] = await db.batch([
    db.prepare(`SELECT ${adminForProgrammes(1)} AS ok`).bind(actor),
    db.prepare("SELECT name, is_active FROM sections WHERE key = ?1").bind(key),
  ]);
  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  const row = current!.results[0] as { name: string; is_active: number } | undefined;
  if (!row) return { ok: false, reason: "not_found" };

  const before = { name: row.name, active: row.is_active === 1 };
  const after = { name: c.name ?? before.name, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const renamed = after.name !== before.name;
  const outcome = await write(
    db,
    auditKey,
    {
      action: renamed ? "academics.section.renamed" : "academics.section.updated",
      entityType: "section",
      entityPublicId: key,
      actorPublicId: actor,
      summary: renamed ? `Section "${before.name}" renamed "${after.name}"` : `Section "${after.name}" switched ${after.active ? "on" : "off"}`,
      before: renamed && before.active === after.active ? { name: before.name } : before,
      after: renamed && before.active === after.active ? { name: after.name } : after,
    },
    db
      .prepare(
        `UPDATE sections SET name = ?2, is_active = ?4
          WHERE key = ?1 AND ${adminForProgrammes(3)} AND NOT EXISTS (SELECT 1 FROM sections o WHERE o.key <> ?1 AND lower(o.name) = lower(?2))`,
      )
      .bind(key, after.name, actor, after.active ? 1 : 0),
  );
  if (outcome === "done") return { ok: true };
  const other = await sectionNamed(db, after.name);
  return { ok: false, reason: other && other !== key ? "conflict" : "not_allowed" };
}

async function sectionNamed(db: D1Database, name: string): Promise<string | null> {
  return (await db.prepare("SELECT key FROM sections WHERE lower(name) = lower(?1)").bind(name).first<{ key: string }>())?.key ?? null;
}
