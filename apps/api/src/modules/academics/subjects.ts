import { newPublicId } from "../../core/ids";
import { coordinatorAnywhere, coordinatorForInstitution } from "./guard";
import { CreateSubjectSchema, SubjectChangesSchema, type SubjectChanges, type SubjectInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/**
 * The school's subject catalogue (D-058). Adding a name is open to any Co-ordinator, because an entry is only a name.
 * Changing one (rename, recode, archive) needs a whole-school Co-ordinator, because it changes the word every section
 * uses. Nothing is deleted: a subject is archived, and then cannot be added to a level.
 */

/** Adds a subject to the catalogue. */
export async function createSubject(db: D1Database, auditKey: string, actor: string, input: SubjectInput): Promise<Created> {
  const parsed = CreateSubjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const subject = { name: parsed.data.name, code: parsed.data.code ?? null };

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.subject.created",
      entityType: "subject",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Subject "${subject.name}" added`,
      after: subject,
    },
    db
      .prepare(`INSERT INTO subjects (public_id, name, code) SELECT ?1, ?2, ?3 WHERE ${coordinatorAnywhere(4)}`)
      .bind(publicId, subject.name, subject.code, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}

interface SubjectRow {
  name: string;
  code: string | null;
  is_archived: number;
}

/** One round trip: is the person allowed to change the catalogue, and what is the subject now? */
async function inspectSubject(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db.prepare("SELECT name, code, is_archived FROM subjects WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    subject: (row!.results[0] as unknown as SubjectRow | undefined) ?? null,
  };
}

/** Renames a subject, changes or removes its code, or archives and restores it. */
export async function updateSubject(db: D1Database, auditKey: string, actor: string, publicId: string, changes: SubjectChanges): Promise<Done> {
  const parsed = SubjectChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, subject } = await inspectSubject(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!subject) return { ok: false, reason: "not_found" };

  const before = { name: subject.name, code: subject.code, archived: subject.is_archived === 1 };
  const after = { name: c.name ?? before.name, code: c.code === undefined ? before.code : c.code, archived: c.archived ?? before.archived };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.subject.updated",
      entityType: "subject",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Subject "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(`UPDATE subjects SET name = ?2, code = ?3, is_archived = ?4 WHERE public_id = ?1 AND ${coordinatorForInstitution(5)}`)
      .bind(publicId, after.name, after.code, after.archived ? 1 : 0, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}
