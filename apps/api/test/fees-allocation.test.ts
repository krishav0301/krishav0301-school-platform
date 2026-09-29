import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { allocate, type LedgerLine } from "../src/modules/fees/allocation";

/**
 * Oldest due first (CLAUDE.md section 6, "Fees and money"): credits (payments and discounts, net of reversals and
 * refunds) are applied to the charges in due-date order. Nothing is stored; this is the one function that decides
 * what is due, what is overdue and what is credit. Property-based: the invariants hold for any ledger.
 */

const day = (n: number) => new Date(Date.UTC(2026, 3, 14) + n * 86_400_000).toISOString().slice(0, 10);

const lineArb: fc.Arbitrary<LedgerLine> = fc.oneof(
  fc.record({ id: fc.uuid(), kind: fc.constantFrom("charge" as const, "carried_dues" as const), amountPaisa: fc.integer({ min: 1, max: 5_000_000 }), dueOn: fc.integer({ min: 0, max: 365 }).map(day) }),
  fc.record({ id: fc.uuid(), kind: fc.constantFrom("payment" as const, "discount" as const), amountPaisa: fc.integer({ min: -5_000_000, max: -1 }), dueOn: fc.constant(null) }),
  fc.record({ id: fc.uuid(), kind: fc.constantFrom("reversal" as const, "refund" as const), amountPaisa: fc.integer({ min: 1, max: 5_000_000 }), dueOn: fc.constant(null) }),
);
const ledgerArb = fc.array(lineArb, { maxLength: 40 });

describe("allocation, by example", () => {
  it("applies a payment to the oldest charge first, and a partial payment leaves the rest due", () => {
    const result = allocate(
      [
        { id: "b", kind: "charge", amountPaisa: 50_000, dueOn: day(30) },
        { id: "a", kind: "charge", amountPaisa: 100_000, dueOn: day(0) },
        { id: "p", kind: "payment", amountPaisa: -120_000, dueOn: null },
      ],
      day(40),
    );
    expect(result.charges.map((c) => [c.id, c.remainingPaisa])).toEqual([
      ["a", 0],
      ["b", 30_000],
    ]);
    expect(result).toMatchObject({ balancePaisa: 30_000, duePaisa: 30_000, overduePaisa: 30_000, creditPaisa: 0 });
  });

  it("a reversal takes a payment's credit back; a discount counts like a payment", () => {
    const result = allocate(
      [
        { id: "a", kind: "charge", amountPaisa: 100_000, dueOn: day(0) },
        { id: "p", kind: "payment", amountPaisa: -100_000, dueOn: null },
        { id: "r", kind: "reversal", amountPaisa: 100_000, dueOn: null },
        { id: "d", kind: "discount", amountPaisa: -25_000, dueOn: null },
      ],
      day(10),
    );
    expect(result).toMatchObject({ balancePaisa: 75_000, duePaisa: 75_000, overduePaisa: 75_000 });
  });

  it("paying more than is due leaves credit, and nothing is overdue before its due date", () => {
    const result = allocate(
      [
        { id: "a", kind: "charge", amountPaisa: 10_000, dueOn: day(50) },
        { id: "p", kind: "payment", amountPaisa: -15_000, dueOn: null },
      ],
      day(0),
    );
    expect(result).toMatchObject({ balancePaisa: -5_000, duePaisa: 0, overduePaisa: 0, creditPaisa: 5_000 });
  });

  it("the next due is the oldest charge with something left on it", () => {
    const result = allocate(
      [
        { id: "a", kind: "charge", amountPaisa: 10_000, dueOn: day(0) },
        { id: "b", kind: "charge", amountPaisa: 10_000, dueOn: day(30) },
        { id: "p", kind: "payment", amountPaisa: -10_000, dueOn: null },
      ],
      day(1),
    );
    expect(result.nextDue).toEqual({ id: "b", dueOn: day(30), remainingPaisa: 10_000 });
  });
});

describe("allocation, for any ledger", () => {
  it("the balance is exactly the sum of the entries", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        expect(allocate(lines, day(200)).balancePaisa).toBe(lines.reduce((s, l) => s + l.amountPaisa, 0));
      }),
    );
  });

  it("due minus credit equals the balance, and neither is ever negative", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        const r = allocate(lines, day(200));
        expect(r.duePaisa).toBeGreaterThanOrEqual(0);
        expect(r.creditPaisa).toBeGreaterThanOrEqual(0);
        expect(r.duePaisa - r.creditPaisa).toBe(r.balancePaisa);
      }),
    );
  });

  it("each charge's remainder is between zero and its amount, and they sum to what is due (plus anything owed with no charge)", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        const r = allocate(lines, day(200));
        for (const c of r.charges) {
          expect(c.remainingPaisa).toBeGreaterThanOrEqual(0);
          expect(c.remainingPaisa).toBeLessThanOrEqual(c.amountPaisa);
        }
        expect(r.charges.reduce((s, c) => s + c.remainingPaisa, 0)).toBeLessThanOrEqual(r.duePaisa);
        if (r.creditPaisa > 0) expect(r.charges.every((c) => c.remainingPaisa === 0)).toBe(true);
      }),
    );
  });

  it("oldest first: once a charge has something left, every later charge is untouched", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        const { charges } = allocate(lines, day(200));
        const firstOpen = charges.findIndex((c) => c.remainingPaisa > 0);
        if (firstOpen === -1) return;
        for (const later of charges.slice(firstOpen + 1)) expect(later.remainingPaisa).toBe(later.amountPaisa);
      }),
    );
  });

  it("overdue is never more than due, and is what is left on charges already past their due date", () => {
    fc.assert(
      fc.property(ledgerArb, fc.integer({ min: 0, max: 400 }), (lines, n) => {
        const r = allocate(lines, day(n));
        expect(r.overduePaisa).toBeLessThanOrEqual(r.duePaisa);
        expect(r.overduePaisa).toBeGreaterThanOrEqual(r.charges.filter((c) => c.dueOn < day(n)).reduce((s, c) => s + c.remainingPaisa, 0));
      }),
    );
  });

  it("the order the entries arrive in does not change the answer", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        const a = allocate(lines, day(200));
        const b = allocate([...lines].reverse(), day(200));
        expect(b.duePaisa).toBe(a.duePaisa);
        expect(b.overduePaisa).toBe(a.overduePaisa);
        expect(b.creditPaisa).toBe(a.creditPaisa);
      }),
    );
  });

  it("every number is a whole number of paisa: no floats anywhere", () => {
    fc.assert(
      fc.property(ledgerArb, (lines) => {
        const r = allocate(lines, day(200));
        for (const value of [r.balancePaisa, r.duePaisa, r.overduePaisa, r.creditPaisa, ...r.charges.map((c) => c.remainingPaisa)]) expect(Number.isInteger(value)).toBe(true);
      }),
    );
  });
});
