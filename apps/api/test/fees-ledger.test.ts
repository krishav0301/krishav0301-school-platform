import { beforeAll, describe, expect, it } from "vitest";

import { newPublicId } from "../src/core/ids";
import { LEDGER_GENESIS, ledgerChainSummary, ledgerInserts, verifyLedgerChain, writeMoney, type LedgerDraft } from "../src/modules/fees/ledger";
import { auditKey, count, db, person, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * The ledger core (Phase 6, slice 1, D-074), written before the fee flows that use it (CLAUDE.md section 7: tests
 * before code for the ledger). Append-only by triggers AND a keyed hash chain; whole paisa; reversals point to the
 * payment; a closed year refuses entries; a failed guard writes nothing, not even a link in the chain.
 */

let fixture: ClassFixture;
let accountant: Person;
let feeItemId: string;
const now = () => new Date().toISOString();

beforeAll(async () => {
  fixture = await classWith("plus2", 2);
  accountant = await person("accountant", "institution");
  const structure = newPublicId();
  await db
    .prepare(
      `INSERT INTO fee_structures (public_id, academic_year_id, level_id, created_by_user_id, created_at)
       SELECT ?1, c.academic_year_id, c.level_id, u.id, ?3 FROM classes c, users u WHERE c.public_id = ?2 AND u.public_id = ?4`,
    )
    .bind(structure, fixture.classId, now(), accountant.publicId)
    .run();
  feeItemId = newPublicId();
  await db
    .prepare("INSERT INTO fee_items (public_id, structure_id, name, amount_paisa, frequency, created_at) SELECT ?1, id, 'Tuition', 250000, 'monthly', ?2 FROM fee_structures WHERE public_id = ?3")
    .bind(feeItemId, now(), structure)
    .run();
});

const draft = (over: Partial<LedgerDraft>): LedgerDraft => ({
  publicId: newPublicId(),
  enrollmentPublicId: fixture.pupils[0]!.enrollmentId,
  kind: "payment",
  amountPaisa: -1000,
  actorPublicId: accountant.publicId,
  createdAt: now(),
  ...over,
});
const append = (drafts: LedgerDraft[], options: Parameters<typeof ledgerInserts>[4] = {}) =>
  writeMoney(db, auditKey, { action: "test.ledger", entityType: "ledger", actorPublicId: accountant.publicId, summary: "test" }, async (head) => (await ledgerInserts(db, auditKey, head, drafts, options)).statements);
const balanceOf = async (enrollment: string) =>
  (await db.prepare("SELECT COALESCE(SUM(le.amount_paisa), 0) AS n FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1").bind(enrollment).first<{ n: number }>())!.n;

describe("appending", () => {
  let paymentId: string;

  it("a charge and a payment append in one batch with one audit entry, and the balance is their sum", async () => {
    paymentId = newPublicId();
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'test.ledger'");
    const outcome = await append([
      draft({ kind: "charge", amountPaisa: 250_000, feeItemPublicId: feeItemId, period: "2083-01", dueOn: "2026-04-14" }),
      draft({ publicId: paymentId, kind: "payment", amountPaisa: -100_000, sourceType: "cash", sourcePublicId: newPublicId() }),
    ]);
    expect(outcome).toBe("done");
    expect(await balanceOf(fixture.pupils[0]!.enrollmentId)).toBe(150_000);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'test.ledger'")).toBe(before + 1);
    expect(await verifyLedgerChain(db, auditKey)).toMatchObject({ ok: true, count: 2 });
  });

  it("a reversal cancels a payment of the same student, in full, once", async () => {
    expect(await append([draft({ kind: "reversal", amountPaisa: 99_999, refersToPublicId: paymentId })])).toBe("rejected");
    expect(await append([draft({ enrollmentPublicId: fixture.pupils[1]!.enrollmentId, kind: "reversal", amountPaisa: 100_000, refersToPublicId: paymentId })])).toBe("rejected");
    expect(await append([draft({ kind: "reversal", amountPaisa: 100_000, refersToPublicId: paymentId })])).toBe("done");
    expect(await append([draft({ kind: "reversal", amountPaisa: 100_000, refersToPublicId: paymentId })])).toBe("duplicate");
    expect(await balanceOf(fixture.pupils[0]!.enrollmentId)).toBe(250_000);
  });

  it("a fee item is charged once per period, and a source applies once", async () => {
    expect(await append([draft({ kind: "charge", amountPaisa: 250_000, feeItemPublicId: feeItemId, period: "2083-01", dueOn: "2026-04-14" })])).toBe("duplicate");
    const source = newPublicId();
    expect(await append([draft({ sourceType: "voucher", sourcePublicId: source })])).toBe("done");
    expect(await append([draft({ sourceType: "voucher", sourcePublicId: source })])).toBe("duplicate");
  });

  it("the signs are enforced: a payment is negative, a charge positive, nothing is zero or fractional", async () => {
    expect(await append([draft({ kind: "payment", amountPaisa: 500 })])).toBe("rejected");
    expect(await append([draft({ kind: "charge", amountPaisa: -500, feeItemPublicId: feeItemId, period: "2083-02", dueOn: "2026-05-14" })])).toBe("rejected");
    expect(await append([draft({ kind: "payment", amountPaisa: 0 })])).toBe("rejected");
    expect(await append([draft({ kind: "payment", amountPaisa: -10.5 })])).toBe("rejected");
  });

  it("a failed guard writes nothing, not even a link: the chain still verifies", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM ledger_entries");
    const outcome = await append([draft({}), draft({})], { guard: "1 = 0" });
    expect(outcome).toBe("not_applied");
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries")).toBe(before);
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });

  it("many writers at once all land, each linked to the one before", async () => {
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => append([draft({ amountPaisa: -1 })])));
    expect(outcomes.every((o) => o === "done")).toBe(true);
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });
});

describe("the database holds the rules even without the code", () => {
  it("no entry is ever updated or deleted", async () => {
    await expect(db.prepare("UPDATE ledger_entries SET amount_paisa = -1 WHERE kind = 'payment'").run()).rejects.toThrow(/append-only/);
    await expect(db.prepare("DELETE FROM ledger_entries").run()).rejects.toThrow(/append-only/);
  });

  it("an entry that does not link to the head is refused", async () => {
    const stale = await ledgerInserts(db, auditKey, LEDGER_GENESIS, [draft({})]);
    await expect(stale.statements[0]!.run()).rejects.toThrow(/ledger chain moved/);
  });

});

describe("tampering is caught", () => {
  it("with the guards removed, an edited amount breaks the chain at that entry, and the summary records the tail", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    const summary = await ledgerChainSummary(db);
    expect(summary.count).toBeGreaterThan(0);

    // Someone with database access removes the guard and edits a payment down.
    const triggerSql = (await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ledger_no_update'").first<{ sql: string }>())!.sql;
    await db.prepare("DROP TRIGGER ledger_no_update").run();
    try {
      const target = (await db.prepare("SELECT id, amount_paisa FROM ledger_entries WHERE kind = 'payment' ORDER BY id LIMIT 1").first<{ id: number; amount_paisa: number }>())!;
      await db.prepare("UPDATE ledger_entries SET amount_paisa = amount_paisa - 1 WHERE id = ?1").bind(target.id).run();
      expect(await verifyLedgerChain(db, auditKey)).toMatchObject({ ok: false, brokenAtId: target.id, reason: "hash mismatch" });
      await db.prepare("UPDATE ledger_entries SET amount_paisa = ?2 WHERE id = ?1").bind(target.id, target.amount_paisa).run();
      expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    } finally {
      await db.prepare(triggerSql).run();
    }
  });
});

describe("closed years", () => {
  it("a closed year refuses entries", async () => {
    const closed = await classWith("bachelors", 1);
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    // Last in the file: a closed year cannot be reopened.
    expect(await append([draft({ enrollmentPublicId: closed.pupils[0]!.enrollmentId })])).toBe("year_closed");
  });
});
