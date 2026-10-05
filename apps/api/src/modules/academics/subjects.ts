import { newPublicId } from "../../core/ids";
import { coordinatorForInstitution, coordinatorForSection } from "./guard";
import { CreateSubjectSchema, SubjectChangesSchema, type SubjectChanges, type SubjectInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/**
 * The school's subject catalogue (D-058). Each subject belongs to one wing (D-114): a Co-ordinator adds subjects to a wing
 * they reach. Changing one (rename, recode, archive, or its wing) needs a whole-school Co-ordinator. The wing changes
 * only while no curriculum uses the subject (FUT point 17): after that, marks and teaching hang off its offerings. Nothing is deleted: a subject is archived, and then cannot be added to a level.
 */

const WING = "(SELECT id FROM sections WHERE key = ?5 AND is_active = 1)";

const inCurriculum = "A curriculum already uses this subject, so its wing stays. Take it off those levels first, or add it to the other wing as a new subject";

/** Adds a subject to the catalogue. */
export async function createSubject(db: D1Database, auditKey: string, actor: string, input: SubjectInput): Promise<Created> {
  const parsed = CreateSubjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const subject = { name: parsed.data.name, code: parsed.data.code ?? null, sectionKey: parsed.data.sectionKey };

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
      .prepare(`INSERT INTO subjects (public_id, section_id, name, code) SELECT ?1, ${WING}, ?2, ?3 WHERE ${WING} IS NOT NULL AND ${coordinatorForSection(4, WING)}`)
      .bind(publicId, subject.name, subject.code, actor, subject.sectionKey),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  const wing = await db.prepare("SELECT 1 AS ok FROM sections WHERE key = ?1 AND is_active = 1").bind(subject.sectionKey).first();
  if (!wing) return { ok: false, reason: "invalid", message: "Choose a wing that exists and is switched on" };
  return { ok: false, reason: "not_allowed" };
}

interface SubjectRow {
  name: string;
  code: string | null;
  is_archived: number;
  section_key: string | null;
  in_curriculum: number;
}

/** One round trip: is the person allowed to change the catalogue, and what is the subject now? */
async function inspectSubject(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db
      .prepare(
        `SELECT x.name, x.code, x.is_archived, s.key AS section_key, EXISTS (SELECT 1 FROM subject_offerings o WHERE o.subject_id = x.id) AS in_curriculum
           FROM subjects x LEFT JOIN sections s ON s.id = x.section_id WHERE x.public_id = ?1`,
      )
      .bind(publicId),
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

  const before = { name: subject.name, code: subject.code, archived: subject.is_archived === 1, sectionKey: subject.section_key };
  // Its wing changes only while no curriculum uses it (FUT point 17); the update below re-checks that as it writes.
  const wingMoves = c.sectionKey !== undefined && c.sectionKey !== before.sectionKey;
  if (wingMoves && subject.in_curriculum === 1) return { ok: false, reason: "invalid", message: inCurriculum };
  const after = { name: c.name ?? before.name, code: c.code === undefined ? before.code : c.code, archived: c.archived ?? before.archived, sectionKey: c.sectionKey ?? before.sectionKey };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };
  if (after.sectionKey !== before.sectionKey) {
    const wing = await db.prepare("SELECT 1 AS ok FROM sections WHERE key = ?1 AND is_active = 1").bind(after.sectionKey).first();
    if (!wing) return { ok: false, reason: "invalid", message: "Choose a wing that exists and is switched on" };
  }

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
      .prepare(
        `UPDATE subjects SET name = ?2, code = ?3, is_archived = ?4,
                section_id = CASE WHEN ?7 = 1 THEN (SELECT id FROM sections WHERE key = ?6 AND is_active = 1) ELSE section_id END
          WHERE public_id = ?1 AND ${coordinatorForInstitution(5)}
            AND (?7 = 0 OR NOT EXISTS (SELECT 1 FROM subject_offerings o WHERE o.subject_id = subjects.id))`,
      )
      .bind(publicId, after.name, after.code, after.archived ? 1 : 0, actor, after.sectionKey, wingMoves ? 1 : 0),
  );
  if (outcome === "done") return { ok: true };
  // A curriculum took the subject between the look and the write: the wing stays.
  if (outcome === "not_applied" && wingMoves && (await inspectSubject(db, publicId, actor)).subject?.in_curriculum === 1) return { ok: false, reason: "invalid", message: inCurriculum };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}
