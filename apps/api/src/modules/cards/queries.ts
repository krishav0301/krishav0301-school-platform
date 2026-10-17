import { adToBsText, nepalDate } from "../../core/dates";
import { viewGuard, type CardOwnerKind } from "./guard";
import type { CardView } from "./schema";

/** One person's side of the SQL: how to find them, their name, and whether they may still use a card. */
export const OWNER = {
  students: {
    column: "student_id",
    find: "SELECT id FROM students WHERE public_id = ?2",
    name: "SELECT TRIM(first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name) FROM students WHERE public_id = ?2",
    active: "SELECT status = 'active' FROM students WHERE public_id = ?2",
    audit: "student",
  },
  people: {
    column: "user_id",
    find: "SELECT id FROM users WHERE public_id = ?2",
    name: "SELECT full_name FROM users WHERE public_id = ?2",
    active: "SELECT is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = users.id AND ra.is_active = 1) FROM users WHERE public_id = ?2",
    audit: "user",
  },
} as const;

/** The Nepal day of a stored time, as a Bikram Sambat date; null outside the verified calendar. */
const bsOf = (iso: string): string | null => adToBsText(nepalDate(new Date(iso)));

interface CardRow {
  card_number: string;
  status: "active" | "retired";
  issued_at: string;
  retired_at: string | null;
  retire_reason: string | null;
}

/** A person's current card and history, for someone allowed to see it; null when they are not (or there is no such person). One round trip. */
export async function readCards(db: D1Database, actor: string, kind: CardOwnerKind, target: string): Promise<CardView | null> {
  const o = OWNER[kind];
  const guard = viewGuard(kind, 1, 2);
  const [head, cards] = await db.batch([
    db.prepare(`SELECT (${o.name}) AS name, (${o.active}) AS owner_active WHERE ${guard}`).bind(actor, target),
    db
      .prepare(
        `SELECT r.card_number, r.status, r.issued_at, r.retired_at, r.retire_reason
           FROM rfid_cards r WHERE r.${o.column} = (${o.find}) AND ${guard} ORDER BY r.id`,
      )
      .bind(actor, target),
  ]);
  const person = head!.results[0] as { name: string | null; owner_active: number | null } | undefined;
  if (!person || person.name === null) return null;

  const rows = cards!.results as unknown as CardRow[];
  const active = rows.find((r) => r.status === "active");
  return {
    owner: { kind: kind === "students" ? "student" : "person", name: person.name },
    current: active ? { cardNumber: active.card_number, issuedAt: active.issued_at, issuedOnBs: bsOf(active.issued_at), usable: person.owner_active === 1 } : null,
    history: rows
      .filter((r) => r.status === "retired")
      .map((r) => ({ cardNumber: r.card_number, issuedAt: r.issued_at, retiredAt: r.retired_at!, retiredOnBs: bsOf(r.retired_at!), reason: r.retire_reason! })),
  };
}
