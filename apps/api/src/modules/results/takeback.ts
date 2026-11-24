import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { principalFor } from "./guard";
import { TakeBackSchema, type TakeBack } from "./schema";

/**
 * Taking a published exam back (D-199, the PM, 2026-11-23). The Principal or Support takes back one class's published
 * exam, naming the subjects that were entered wrongly and why. In one batch: a withdrawal is recorded beside the
 * publication (nothing is deleted), the named subjects' sheets go back to their teachers as drafts with the reason as the
 * note, and the other subjects' sheets wait as verified. While it is open, nobody sees the exam's result, nor the class's
 * final result if it has one. The Co-ordinator then publishes the exam again as usual (`publishClass`), which adds the next
 * version of every card and closes the withdrawal.
 */

export type TakeBackResult =
  | { ok: true; withdrawalId: string; sentBack: number }
  | { ok: false; reason: "not_found" | "year_closed" | "not_published" | "already_taken_back" | "open_rechecks" }
  | { ok: false; reason: "invalid"; message: string };

export async function takeBackResults(db: D1Database, auditKey: string, me: string, classId: string, terminalId: string, input: TakeBack): Promise<TakeBackResult> {
  const parsed = TakeBackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const offerings = [...new Set(parsed.data.offeringIds)];

  const [headResult, sheetsResult] = await db.batch([
    db
      .prepare(
        `SELECT ay.status AS year_status, t.name AS terminal_name, ${principalFor(3)} AS allowed,
                (SELECT rp.public_id FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id) AS publication_id,
                EXISTS (SELECT 1 FROM result_withdrawals w WHERE w.class_id = cl.id AND w.republished_at IS NULL) AS taken_back,
                (SELECT COUNT(*) FROM rechecks r JOIN mark_sheets ms ON ms.id = r.sheet_id WHERE ms.class_id = cl.id AND ms.terminal_id = t.id AND r.status = 'open') AS open_rechecks
           FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN terminals t ON t.academic_year_id = ay.id AND t.public_id = ?2 AND t.weight IS NOT NULL
          WHERE cl.public_id = ?1`,
      )
      .bind(classId, terminalId, me),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, sb.name AS subject_name, ms.status
           FROM mark_sheets ms JOIN classes cl ON cl.id = ms.class_id JOIN terminals t ON t.id = ms.terminal_id
           JOIN subject_offerings o ON o.id = ms.offering_id JOIN subjects sb ON sb.id = o.subject_id
          WHERE cl.public_id = ?1 AND t.public_id = ?2`,
      )
      .bind(classId, terminalId),
  ]);
  const head = headResult!.results[0] as { year_status: string; terminal_name: string; allowed: number; publication_id: string | null; taken_back: number; open_rechecks: number } | undefined;
  if (!head || head.allowed !== 1) return { ok: false, reason: "not_found" };
  if (head.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (!head.publication_id) return { ok: false, reason: "not_published" };
  if (head.taken_back === 1) return { ok: false, reason: "already_taken_back" };
  if (head.open_rechecks > 0) return { ok: false, reason: "open_rechecks" };
  const sheets = sheetsResult!.results as { offering_id: string; subject_name: string; status: string }[];
  const published = new Map(sheets.filter((s) => s.status === "published").map((s) => [s.offering_id, s.subject_name]));
  if (offerings.some((id) => !published.has(id))) return { ok: false, reason: "invalid", message: "A chosen subject is not part of this published result" };

  const withdrawalId = newPublicId();
  const at = new Date().toISOString();
  const offeringsJson = JSON.stringify(offerings);
  // Every later statement only acts if this withdrawal went in (the same batch: a lost race writes nothing).
  const mine = `EXISTS (SELECT 1 FROM result_withdrawals w WHERE w.public_id = ?1 AND w.class_id = mark_sheets.class_id AND w.terminal_id = mark_sheets.terminal_id AND w.republished_at IS NULL)`;
  const sentBack = `mark_sheets.offering_id IN (SELECT o.id FROM subject_offerings o WHERE o.public_id IN (SELECT value FROM json_each(?2)))`;
  const statements = [
    db
      .prepare(
        `INSERT INTO result_withdrawals (public_id, publication_id, class_id, terminal_id, offerings, reason, withdrawn_by_user_id, withdrawn_at)
         SELECT ?4, rp.id, rp.class_id, rp.terminal_id, ?5, ?6, (SELECT id FROM users WHERE public_id = ?3), ?7
           FROM result_publications rp JOIN classes cl ON cl.id = rp.class_id JOIN terminals t ON t.id = rp.terminal_id
          WHERE cl.public_id = ?1 AND t.public_id = ?2 AND ${principalFor(3)}
            AND NOT EXISTS (SELECT 1 FROM rechecks r JOIN mark_sheets ms ON ms.id = r.sheet_id WHERE ms.class_id = rp.class_id AND ms.terminal_id = rp.terminal_id AND r.status = 'open')`,
      )
      .bind(classId, terminalId, me, withdrawalId, offeringsJson, parsed.data.reason, at),
    // The subjects that were right wait as verified, so they need not be checked again.
    db
      .prepare(`UPDATE mark_sheets SET status = 'verified', updated_at = ?3 WHERE status = 'published' AND ${mine} AND NOT ${sentBack}`)
      .bind(withdrawalId, offeringsJson, at),
    // Last: the subjects sent back to their teachers, with the reason as the note. Changes a row only if the withdrawal went in.
    db
      .prepare(
        `UPDATE mark_sheets SET status = 'draft', note = ?4, verified_by_user_id = NULL, verified_at = NULL, updated_at = ?3
          WHERE status = 'published' AND ${mine} AND ${sentBack}`,
      )
      .bind(withdrawalId, offeringsJson, at, parsed.data.reason),
  ];
  const names = offerings.map((id) => published.get(id)!);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.taken_back",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: me,
        summary: `Results taken back for ${head.terminal_name}; sent back to the teachers: ${names.join(", ")}`,
        reason: parsed.data.reason,
        after: { terminalId, withdrawalId, publicationId: head.publication_id, offeringIds: offerings },
      },
      statements,
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true, withdrawalId, sentBack: offerings.length } : { ok: false, reason: "already_taken_back" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    if (/UNIQUE constraint failed: result_withdrawals/i.test(message)) return { ok: false, reason: "already_taken_back" };
    throw error;
  }
}
