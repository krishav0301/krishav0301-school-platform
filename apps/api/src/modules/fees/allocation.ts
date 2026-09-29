/**
 * Oldest due first (CLAUDE.md section 6): what a student owes is computed from the ledger, never stored. Every credit
 * (payments and discounts, net of reversals and refunds) is pooled and applied to the charges in due-date order. What
 * is left on a charge is due; left on one whose due date has passed, it is overdue. Whole paisa only.
 */

export type LedgerKind = "charge" | "carried_dues" | "discount" | "payment" | "reversal" | "refund";

export interface LedgerLine {
  id: string;
  kind: LedgerKind;
  /** Signed: positive raises what is owed, negative lowers it. */
  amountPaisa: number;
  /** For a charge or carried dues: the AD day it falls due. */
  dueOn: string | null;
}

export interface Allocation {
  /** The sum of every entry: positive is owed, negative is credit. */
  balancePaisa: number;
  /** What is still owed on charges (never negative). */
  duePaisa: number;
  /** The part of `duePaisa` on charges whose due date is before `today`. */
  overduePaisa: number;
  /** Credit left over after every charge is paid (never negative). */
  creditPaisa: number;
  /** Each charge, oldest due first, with what is left on it. */
  charges: { id: string; amountPaisa: number; dueOn: string; remainingPaisa: number }[];
  /** The oldest charge with something left, or null. */
  nextDue: { id: string; dueOn: string; remainingPaisa: number } | null;
}

const isDebit = (kind: LedgerKind) => kind === "charge" || kind === "carried_dues";

export function allocate(lines: readonly LedgerLine[], today: string): Allocation {
  // Ties on the due date are broken by id so the answer never depends on the order the entries arrive in.
  const debits = lines
    .filter((l) => isDebit(l.kind) && l.dueOn !== null)
    .map((l) => ({ id: l.id, amountPaisa: l.amountPaisa, dueOn: l.dueOn as string }))
    .sort((a, b) => (a.dueOn === b.dueOn ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.dueOn < b.dueOn ? -1 : 1));

  const balancePaisa = lines.reduce((sum, l) => sum + l.amountPaisa, 0);
  // Every non-debit entry moves the credit pool: payments and discounts add to it, reversals and refunds take away.
  let pool = -lines.filter((l) => !isDebit(l.kind)).reduce((sum, l) => sum + l.amountPaisa, 0);

  const charges = debits.map((d) => {
    const applied = pool > 0 ? Math.min(pool, d.amountPaisa) : 0;
    pool -= applied;
    return { ...d, remainingPaisa: d.amountPaisa - applied };
  });

  // A pool below zero (a refund or reversal larger than every credit) is owed now, with no charge to sit on.
  const owedNow = Math.max(-pool, 0);
  const duePaisa = charges.reduce((sum, c) => sum + c.remainingPaisa, 0) + owedNow;
  const overduePaisa = charges.filter((c) => c.dueOn < today).reduce((sum, c) => sum + c.remainingPaisa, 0) + owedNow;
  const open = charges.find((c) => c.remainingPaisa > 0);
  return {
    balancePaisa: balancePaisa + 0, // never -0
    duePaisa,
    overduePaisa,
    creditPaisa: Math.max(pool, 0),
    charges,
    nextDue: open ? { id: open.id, dueOn: open.dueOn, remainingPaisa: open.remainingPaisa } : null,
  };
}
