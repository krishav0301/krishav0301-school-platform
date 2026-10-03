import { newPublicId } from "../../core/ids";
import { adminForProgrammes } from "./guard";
import { CreateSectionSchema, SectionChangesSchema, type SectionChanges, type SectionInput } from "./schema";
import { CODE_LOCKED } from "./queries";
import { firstMessage, write, type Done, type Failure } from "./write";

/**
 * Sections are the Admin's, like programmes (D-095): a school starts with none, and the Admin adds them ("Bachelor's",
 * "Master's", or "Primary", "High School") before adding the programmes under them. The key is generated and never
 * changes, because section scopes, receipt numbering and the Top 20 are keyed by it; only the name changes. A section is
 * never deleted (CLAUDE.md section 6), and two sections may not share a name, so nobody has to tell them apart by key.
 *
 * Each section also has a receipt code (D-102): the short marker its receipt numbers start with, such as P2-2083-00007,
 * because the generated key means nothing on a receipt a family keeps. Two sections may not share one, and it is fixed
 * once the section has issued a receipt.
 */

/**
 * A receipt code made from a section's name: the initials of its words (a run of digits kept whole), or the first four
 * letters of a one-word name. "Master's Degrees" gives MD, "Bachelor's" BACH, "+2 (Grade 11-12)" P2 (a bracketed part is left out; "+" reads as P). Only a
 * suggestion: the Principal may type another.
 */
export function suggestReceiptCode(name: string): string {
  const words = name.replace(/\([^)]*\)/g, " ").replace(/\+/g, " P").replace(/['’]/g, "").toUpperCase().match(/[A-Z]+|[0-9]+/g) ?? [];
  const initials = words.map((w) => (/^[0-9]/.test(w) ? w : w[0])).join("");
  const code = initials.length >= 2 ? initials : words.join("").slice(0, 4);
  return (code.length >= 2 ? code : `${code}SEC`).slice(0, 6);
}

/** The suggestion, or the suggestion with a digit added when another section already uses it. */
function freeCode(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n++) {
    const candidate = `${wanted.slice(0, 6 - String(n).length)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return wanted;
}

export type SectionCreated = { ok: true; key: string } | Failure;

export async function createSection(db: D1Database, auditKey: string, actor: string, input: SectionInput): Promise<SectionCreated> {
  const parsed = CreateSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { name } = parsed.data;
  let receiptCode = parsed.data.receiptCode;
  if (!receiptCode) {
    const taken = await db.prepare("SELECT receipt_code AS code FROM sections WHERE receipt_code IS NOT NULL").all<{ code: string }>();
    receiptCode = freeCode(suggestReceiptCode(name), new Set(taken.results.map((r) => r.code)));
  }

  const key = `s${newPublicId().slice(0, 10)}`;
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.section.created",
      entityType: "section",
      entityPublicId: key,
      actorPublicId: actor,
      summary: `Section "${name}" added (receipt code ${receiptCode})`,
      after: { name, receiptCode },
    },
    db
      .prepare(
        `INSERT INTO sections (key, name, ordering, receipt_code)
         SELECT ?1, ?2, COALESCE((SELECT MAX(ordering) FROM sections), -1) + 1, ?4
          WHERE ${adminForProgrammes(3)} AND NOT EXISTS (SELECT 1 FROM sections WHERE lower(name) = lower(?2))`,
      )
      .bind(key, name, actor, receiptCode),
  );
  if (outcome === "done") return { ok: true, key };
  if (outcome === "duplicate") return { ok: false, reason: "code_taken" };
  return { ok: false, reason: (await sectionNamed(db, name)) ? "conflict" : "not_allowed" };
}

/** Renames a section, or switches it off and on (D-097). The key, and everything keyed by it, stays the same. */
export async function updateSection(db: D1Database, auditKey: string, actor: string, key: string, changes: SectionChanges): Promise<Done> {
  const parsed = SectionChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const [allowed, current] = await db.batch([
    db.prepare(`SELECT ${adminForProgrammes(1)} AS ok`).bind(actor),
    db.prepare(`SELECT name, is_active, receipt_code, ${CODE_LOCKED("sections")} AS code_locked FROM sections WHERE key = ?1`).bind(key),
  ]);
  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  const row = current!.results[0] as { name: string; is_active: number; receipt_code: string | null; code_locked: number } | undefined;
  if (!row) return { ok: false, reason: "not_found" };

  const before = { name: row.name, active: row.is_active === 1, receiptCode: row.receipt_code };
  const after = { name: c.name ?? before.name, active: c.active ?? before.active, receiptCode: c.receiptCode ?? before.receiptCode };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };
  const recoded = after.receiptCode !== before.receiptCode;
  if (recoded && row.code_locked === 1) return { ok: false, reason: "code_locked" };

  const renamed = after.name !== before.name;
  const changed = (["name", "active", "receiptCode"] as const).filter((k) => after[k] !== before[k]);
  const pick = (o: typeof before) => Object.fromEntries(changed.map((k) => [k, o[k]]));
  const outcome = await write(
    db,
    auditKey,
    {
      action: renamed ? "academics.section.renamed" : "academics.section.updated",
      entityType: "section",
      entityPublicId: key,
      actorPublicId: actor,
      summary: renamed
        ? `Section "${before.name}" renamed "${after.name}"`
        : recoded
          ? `Section "${after.name}" receipt code set to ${after.receiptCode}`
          : `Section "${after.name}" switched ${after.active ? "on" : "off"}`,
      before: pick(before),
      after: pick(after),
    },
    db
      .prepare(
        // The code is re-checked here, in the same statement: a receipt issued since the read above locks it.
        `UPDATE sections SET name = ?2, is_active = ?4, receipt_code = ?5
          WHERE key = ?1 AND ${adminForProgrammes(3)} AND NOT EXISTS (SELECT 1 FROM sections o WHERE o.key <> ?1 AND lower(o.name) = lower(?2))
            AND (receipt_code IS ?5 OR NOT ${CODE_LOCKED("sections")})`,
      )
      .bind(key, after.name, actor, after.active ? 1 : 0, after.receiptCode),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "code_taken" };
  const other = await sectionNamed(db, after.name);
  return { ok: false, reason: other && other !== key ? "conflict" : "not_allowed" };
}

async function sectionNamed(db: D1Database, name: string): Promise<string | null> {
  return (await db.prepare("SELECT key FROM sections WHERE lower(name) = lower(?1)").bind(name).first<{ key: string }>())?.key ?? null;
}
