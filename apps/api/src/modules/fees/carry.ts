import { newPublicId } from "../../core/ids";
import { ledgerInserts, writeMoney } from "./ledger";

/**
 * Promotion's money (D-110). The balance is never stored (CLAUDE.md section 6): it is the sum of an enrollment's ledger.
 * What is still owed when a student moves to the next term is carried into the new term's enrollment as one
 * `carried_dues` entry, written only to the new term (the closed one is never written to). Its source is the old
 * enrollment, and the ledger allows one entry per source, so carrying twice is impossible.
 */

/** What each enrollment owes now (positive) or is owed (negative), in paisa. One round trip. */
export async function enrollmentBalances(db: D1Database, enrollmentPublicIds: readonly string[]): Promise<Map<string, number>> {
  if (enrollmentPublicIds.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT en.public_id, COALESCE(SUM(le.amount_paisa), 0) AS balance
         FROM enrollments en LEFT JOIN ledger_entries le ON le.enrollment_id = en.id
        WHERE en.public_id IN (SELECT value FROM json_each(?1)) GROUP BY en.id`,
    )
    .bind(JSON.stringify([...new Set(enrollmentPublicIds)]))
    .all<{ public_id: string; balance: number }>();
  return new Map(results.map((r) => [r.public_id, r.balance]));
}

export type CarryResult = "carried" | "nothing_owed" | "already_carried" | "not_applied";

/**
 * Carries what `from` still owes into `to`, due on `dueOn`. Safe to repeat: a second call finds it already carried. Only
 * an amount owed is carried; a credit stays with the old enrollment (OPEN: what happens to a credit at promotion).
 */
export async function carryDues(db: D1Database, key: string, actor: string, from: string, to: string, dueOn: string): Promise<CarryResult> {
  const owed = (await enrollmentBalances(db, [from])).get(from) ?? 0;
  if (owed <= 0) return "nothing_owed";
  const outcome = await writeMoney(
    db,
    key,
    { action: "fees.dues.carried", entityType: "enrollment", entityPublicId: to, actorPublicId: actor, summary: `Dues of ${owed} paisa carried into the new term`, after: { from, amountPaisa: owed } },
    async (head) =>
      (
        await ledgerInserts(
          db,
          key,
          head,
          [
            {
              publicId: newPublicId(),
              enrollmentPublicId: to,
              kind: "carried_dues",
              amountPaisa: owed,
              dueOn,
              sourceType: "carried_dues",
              sourcePublicId: from,
              memo: "Carried from the previous term",
              actorPublicId: actor,
              createdAt: new Date().toISOString(),
            },
          ],
          // The new enrollment must have come from the old one, and the term it is in must be open.
          { guard: "en.previous_enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?16) AND ay.status <> 'closed'", guardBinds: [from] },
        )
      ).statements,
  );
  if (outcome === "done") return "carried";
  if (outcome === "duplicate") return "already_carried";
  return "not_applied";
}
