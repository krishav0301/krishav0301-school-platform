import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { manageGuard, type CardOwnerKind } from "./guard";
import { OWNER } from "./queries";
import { LinkCardSchema, RetireCardSchema } from "./schema";

export type CardResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; error: "card_in_use" | "changed" }
  | { ok: false; reason: "invalid"; message: string };

const firstMessage = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? "That is not valid";
const isUnique = (error: unknown) => /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));
const isRefused = (error: unknown) => /CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(error instanceof Error ? error.message : String(error));

/**
 * Gives a person a card, or replaces the one they have (D-174). One audited batch, and the actor is checked again
 * inside it. Sending the same number for the same person again changes nothing and records nothing, so a retry after a
 * lost answer is safe. A number belongs to one person for good: another person's, or one retired, is refused. A
 * replacement needs a reason, and the old card is retired in the same batch.
 */
export async function linkCard(db: D1Database, auditKey: string, actor: string, kind: CardOwnerKind, target: string, input: unknown, now = new Date()): Promise<CardResult> {
  const parsed = LinkCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const number = parsed.data.cardNumber.toUpperCase();
  const reason = parsed.data.reason ?? null;
  const o = OWNER[kind];
  const guard = manageGuard(kind, 1, 2);

  const [state, owner] = await db.batch([
    db
      .prepare(
        `SELECT (${guard}) AS allowed, (${o.name}) AS name,
                (SELECT r.card_number FROM rfid_cards r WHERE r.${o.column} = (${o.find}) AND r.status = 'active') AS active_number`,
      )
      .bind(actor, target),
    db.prepare(`SELECT r.status, r.${o.column} = (${o.find}) AS same_owner FROM rfid_cards r WHERE r.card_number = ?1`).bind(number, target),
  ]);
  const now_ = state!.results[0] as { allowed: number; name: string | null; active_number: string | null } | undefined;
  if (!now_ || now_.allowed !== 1 || now_.name === null) return { ok: false, reason: "not_found" };

  const held = owner!.results[0] as { status: string; same_owner: number } | undefined;
  if (held) return held.status === "active" && held.same_owner === 1 ? { ok: true } : { ok: false, reason: "conflict", error: "card_in_use" };
  if (now_.active_number && !reason) return { ok: false, reason: "invalid", message: "Say why the card is being replaced" };

  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (now_.active_number) {
    statements.push(
      db
        .prepare(
          `UPDATE rfid_cards SET status = 'retired', retired_at = ?3, retired_by_user_id = (SELECT id FROM users WHERE public_id = ?1), retire_reason = ?4
            WHERE status = 'active' AND ${o.column} = (${o.find}) AND ${guard}`,
        )
        .bind(actor, target, at, reason),
    );
  }
  // Last: it changes a row only if the person was allowed, which is what decides whether the audit entry is written.
  statements.push(
    db
      .prepare(
        `INSERT INTO rfid_cards (public_id, card_number, ${o.column}, issued_at, issued_by_user_id)
         SELECT ?3, ?4, (${o.find}), ?5, mu.id FROM users mu WHERE mu.public_id = ?1 AND ${guard}`,
      )
      .bind(actor, target, newPublicId(), number, at),
  );

  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: now_.active_number ? "cards.replaced" : "cards.linked",
        entityType: o.audit,
        entityPublicId: target,
        actorPublicId: actor,
        summary: now_.active_number ? `Card replaced for ${now_.name}` : `Card linked to ${now_.name}`,
        ...(now_.active_number ? { before: { cardNumber: now_.active_number }, reason: reason! } : {}),
        after: { cardNumber: number },
      },
      statements,
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (isUnique(error)) {
      // Another request got there first: say whether the number is now taken, or the person's card changed under us.
      const taken = await db.prepare("SELECT 1 AS taken FROM rfid_cards WHERE card_number = ?1").bind(number).first();
      return { ok: false, reason: "conflict", error: taken ? "card_in_use" : "changed" };
    }
    if (isRefused(error)) return { ok: false, reason: "not_found" };
    throw error;
  }
}

/** Retires the person's active card with a reason, and links no other. Nothing is deleted. */
export async function retireCard(db: D1Database, auditKey: string, actor: string, kind: CardOwnerKind, target: string, input: unknown, now = new Date()): Promise<CardResult> {
  const parsed = RetireCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const o = OWNER[kind];
  const guard = manageGuard(kind, 1, 2);
  const name = await db.prepare(`SELECT (${o.name}) AS name WHERE ${guard}`).bind(actor, target).first<{ name: string | null }>();
  if (!name || name.name === null) return { ok: false, reason: "not_found" };

  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "cards.retired",
        entityType: o.audit,
        entityPublicId: target,
        actorPublicId: actor,
        summary: `Card retired for ${name.name}`,
        reason: parsed.data.reason,
      },
      [
        db
          .prepare(
            `UPDATE rfid_cards SET status = 'retired', retired_at = ?3, retired_by_user_id = (SELECT id FROM users WHERE public_id = ?1), retire_reason = ?4
              WHERE status = 'active' AND ${o.column} = (${o.find}) AND ${guard}`,
          )
          .bind(actor, target, now.toISOString(), parsed.data.reason),
      ],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (isRefused(error)) return { ok: false, reason: "not_found" };
    throw error;
  }
}
