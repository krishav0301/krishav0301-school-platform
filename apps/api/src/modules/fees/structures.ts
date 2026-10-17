import { recordAudit } from "../../core/audit";
import { adToBsText, nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { formatNpr } from "./money";
import type { Grant } from "../../core/permissions";
import { requestApproval, type ApprovalHandler } from "../approvals/service";
import { accountantFor, anyAccountant, structureSection } from "./guard";
import { ledgerInserts, writeMoney, type LedgerDraft } from "./ledger";
import { billingSchedule, termMonths, yearlyAmount, type Frequency } from "./policy";
import { ChangeFeeItemSchema, NewFeeItemSchema, type ChangeFeeItem, type FeeStructure, type FeeStructureList, type NewFeeItem, type NewPeriod, type NewStructure } from "./schema";

/**
 * Fee structures (D-172, `docs/superpowers/specs/2026-10-17-fee-structures-design.md`): a named priced list with a wing and
 * a start and an end date, drafted by the Accountant, approved by the Principal through the approvals engine, then live
 * and fixed. An approved structure is linked to levels (no approval), and every student of a linked level is charged
 * automatically. Charges are made idempotently: the ledger's own unique index allows one charge per student, line and
 * period. A "version" is a row of `fee_structures`; the first has no `root_id`, the others share its id as theirs.
 */

export type Failure =
  | { ok: false; reason: "not_found" | "conflict" | "not_draft" | "not_live" | "year_closed" | "not_allowed" | "in_use" }
  | { ok: false; reason: "invalid"; message: string };
export type Created = { ok: true; publicId: string } | Failure;
export type Done = { ok: true } | Failure;

const now = () => new Date().toISOString();
const sectionFilter = (grant: Grant): string | null => (grant.institution ? null : JSON.stringify(grant.sections));

type Outcome = "done" | "not_applied" | "duplicate" | "not_draft" | "year_closed" | "not_live" | "wrong_wing" | "in_use";

async function audited(db: D1Database, key: string, event: Parameters<typeof recordAudit>[2], statements: D1PreparedStatement[]): Promise<Outcome> {
  try {
    const { applied } = await recordAudit(db, key, event, statements, { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed|one fee structure at a time/i.test(message)) return "duplicate";
    if (/only a draft fee structure|not a draft is fixed/i.test(message)) return "not_draft";
    if (/only a live fee structure/i.test(message)) return "not_live";
    if (/own wing/i.test(message)) return "wrong_wing";
    if (/fees are in use/i.test(message)) return "in_use";
    if (/academic year is closed/i.test(message)) return "year_closed";
    throw error;
  }
}

/** How many BS months a structure's dates span: what a legacy monthly item is charged for. Twelve if the days cannot be converted. */
function monthsOf(startDate: string, endDate: string): number {
  try {
    return termMonths(startDate, endDate).length;
  } catch {
    return 12;
  }
}

const validDates = (startDate: string, endDate: string): string | null => (endDate > startDate ? null : "The end date must be after the start date");

// --- Drafting ------------------------------------------------------------------------------------

/** Drafts a new structure in a wing: a name, a start date and an end date (AD). The Accountant of that wing, or of every wing. */
export async function createStructure(db: D1Database, key: string, actor: string, input: NewStructure): Promise<Created> {
  const bad = validDates(input.startDate, input.endDate);
  if (bad) return { ok: false, reason: "invalid", message: bad };
  const publicId = newPublicId();
  const outcome = await audited(db, key, { action: "fees.structure.created", entityType: "fee_structure", entityPublicId: publicId, actorPublicId: actor, summary: `Fee structure drafted: ${input.name}`, after: input }, [
    db
      .prepare(
        `INSERT INTO fee_structures (public_id, section_id, name, start_date, end_date, created_by_user_id, created_at)
         SELECT ?1, s.id, ?4, ?5, ?6, u.id, ?7 FROM sections s, users u
          WHERE s.key = ?2 AND u.public_id = ?3 AND ${accountantFor(3, "s.id")}`,
      )
      .bind(publicId, input.sectionKey, actor, input.name, input.startDate, input.endDate, now()),
  ]);
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_found" };
}

/** The structure's own guard: this actor is the Accountant for its wing. `?1` the actor, `?2` the structure's public id. */
const STRUCTURE_GUARD = accountantFor(1, structureSection("(SELECT id FROM fee_structures WHERE public_id = ?2)"));

/**
 * Starts the next period of a structure (the PM, 2026-10-17: "the steps repeat, the data is already there"): a new draft
 * of the same name and wing with the new dates and a copy of the lines of the structure's live version (or, if it has
 * none, its newest). It needs approval before it can be linked, like any new structure.
 */
export async function startNextPeriod(db: D1Database, key: string, actor: string, fromId: string, input: NewPeriod): Promise<Created> {
  const bad = validDates(input.startDate, input.endDate);
  if (bad) return { ok: false, reason: "invalid", message: bad };
  const publicId = newPublicId();
  const outcome = await audited(db, key, { action: "fees.structure.next_period", entityType: "fee_structure", entityPublicId: publicId, actorPublicId: actor, summary: "Next period of a fee structure started", after: { from: fromId, ...input } }, [
    db
      .prepare(
        `INSERT INTO fee_structures (public_id, section_id, name, start_date, end_date, created_by_user_id, created_at)
         SELECT ?1, src.section_id, src.name, ?4, ?5, u.id, ?6 FROM fee_structures src, users u
          WHERE src.public_id = ?2 AND u.public_id = ?3 AND ${accountantFor(3, "src.section_id")}`,
      )
      .bind(publicId, fromId, actor, input.startDate, input.endDate, now()),
  ]);
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome !== "done") return { ok: false, reason: "not_found" };
  // The lines, copied from the version in force (a draft, so the line triggers allow it).
  await db
    .prepare(
      `INSERT INTO fee_items (public_id, structure_id, name, amount_paisa, frequency, created_at)
       SELECT lower(hex(randomblob(16))), (SELECT id FROM fee_structures WHERE public_id = ?1), fi.name, fi.amount_paisa, fi.frequency, ?2
         FROM fee_items fi WHERE fi.is_active = 1 AND fi.structure_id =
              (SELECT v.id FROM fee_structures v WHERE COALESCE(v.root_id, v.id) = (SELECT COALESCE(s.root_id, s.id) FROM fee_structures s WHERE s.public_id = ?3)
                ORDER BY (v.status = 'live') DESC, v.id DESC LIMIT 1)
        ORDER BY fi.id`,
    )
    .bind(publicId, now(), fromId)
    .run();
  return { ok: true, publicId };
}

export async function addItem(db: D1Database, key: string, actor: string, structureId: string, input: NewFeeItem): Promise<Created> {
  const parsed = NewFeeItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const publicId = newPublicId();
  const outcome = await audited(db, key, { action: "fees.item.added", entityType: "fee_structure", entityPublicId: structureId, actorPublicId: actor, summary: `Fee line added: ${parsed.data.name}`, after: parsed.data }, [
    db
      .prepare(
        `INSERT INTO fee_items (public_id, structure_id, name, amount_paisa, frequency, created_at)
         SELECT ?3, fs.id, ?4, ?5, 'one_time', ?6 FROM fee_structures fs WHERE fs.public_id = ?2 AND ${STRUCTURE_GUARD}`,
      )
      .bind(actor, structureId, publicId, parsed.data.name, parsed.data.amountPaisa, now()),
  ]);
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "not_draft") return { ok: false, reason: "not_draft" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  return { ok: false, reason: "not_found" };
}

export async function changeItem(db: D1Database, key: string, actor: string, itemId: string, input: ChangeFeeItem): Promise<Done> {
  const parsed = ChangeFeeItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const c = parsed.data;
  const outcome = await audited(db, key, { action: "fees.item.changed", entityType: "fee_item", entityPublicId: itemId, actorPublicId: actor, summary: "Fee line changed", after: c }, [
    db
      .prepare(
        `UPDATE fee_items SET name = COALESCE(?3, name), amount_paisa = COALESCE(?4, amount_paisa), is_active = COALESCE(?5, is_active)
          WHERE public_id = ?2 AND ${accountantFor(1, structureSection("fee_items.structure_id"))}`,
      )
      .bind(actor, itemId, c.name ?? null, c.amountPaisa ?? null, c.isActive === undefined ? null : c.isActive ? 1 : 0),
  ]);
  if (outcome === "done") return { ok: true };
  if (outcome === "not_draft") return { ok: false, reason: "not_draft" };
  return { ok: false, reason: "not_found" };
}

/** Sends a draft for the Principal's approval, through the engine. The actor must be the Accountant for its wing. */
export async function sendStructure(db: D1Database, key: string, actor: string, structureId: string): Promise<Created> {
  const allowed = await db.prepare(`SELECT ${STRUCTURE_GUARD} AS ok`).bind(actor, structureId).first<{ ok: number }>();
  if (allowed?.ok !== 1) return { ok: false, reason: "not_found" };
  const result = await requestApproval(db, key, actor, { kind: "fee_structure", subjectId: structureId });
  if (result.ok) return result;
  if (result.reason === "conflict") return { ok: false, reason: "conflict" };
  if (result.reason === "invalid") return result;
  return { ok: false, reason: result.reason === "not_allowed" ? "not_allowed" : "not_found" };
}

// --- The approvals kind ----------------------------------------------------------------------------

const FREQUENCY_WORD: Record<Frequency, string> = { one_time: "", monthly: " a month", yearly: " a term", whole_course: " for the course" };

export const feeStructureApprovalHandler: ApprovalHandler = {
  requesterSql: anyAccountant,
  async resolveId(db, publicId) {
    return (await db.prepare("SELECT id FROM fee_structures WHERE public_id = ?1").bind(publicId).first<{ id: number }>())?.id ?? null;
  },
  async describe(db, id) {
    const [head, items, before] = await db.batch([
      db.prepare("SELECT fs.public_id, fs.name, fs.start_date, fs.end_date FROM fee_structures fs WHERE fs.id = ?1").bind(id),
      db.prepare("SELECT name, amount_paisa, frequency FROM fee_items WHERE structure_id = ?1 AND is_active = 1 ORDER BY id").bind(id),
      db.prepare("SELECT name, amount_paisa FROM fee_items WHERE is_active = 1 AND structure_id = (SELECT replaces_id FROM fee_structures WHERE id = ?1) ORDER BY id").bind(id),
    ]);
    const previousLines = (before!.results as unknown as { name: string; amount_paisa: number }[]).map((i) => ({ name: i.name, amountPaisa: i.amount_paisa }));
    const previous = previousLines.length > 0 ? { items: previousLines, totalPaisa: previousLines.reduce((sum, i) => sum + i.amountPaisa, 0) } : null;
    const row = head!.results[0] as { public_id: string; name: string; start_date: string; end_date: string } | undefined;
    if (!row) return null;
    const months = monthsOf(row.start_date, row.end_date);
    const lines = (items!.results as unknown as { name: string; amount_paisa: number; frequency: Frequency }[]).map((i) => ({ name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency }));
    const totalPaisa = lines.reduce((s, i) => s + yearlyAmount(i, months), 0);
    // The Principal decides from this line, so it says what is being approved (found by the year test, D-084).
    const lineWords = lines.map((i) => `${i.name} NPR ${formatNpr(i.amountPaisa)}${FREQUENCY_WORD[i.frequency]}`).join("; ");
    const period = `${adToBsText(row.start_date) ?? row.start_date} to ${adToBsText(row.end_date) ?? row.end_date}`;
    return {
      snapshot: { name: row.name, startDate: row.start_date, endDate: row.end_date, items: lines, totalPaisa, previous },
      summary: `${previous ? "New version of fee structure" : "Fee structure"} "${row.name}", ${period}: ${lineWords}. Total NPR ${formatNpr(totalPaisa)}${previous ? ` (was NPR ${formatNpr(previous.totalPaisa)})` : ""}`,
      subjectPublicId: row.public_id,
    };
  },
  /** Every line and the total, as the structure stands now (D-102). */
  async detail(db, id) {
    const described = await this.describe(db, id);
    if (!described) return null;
    const s = described.snapshot as { name: string; startDate: string; endDate: string; items: { name: string; amountPaisa: number; frequency: Frequency }[]; totalPaisa: number; previous: { items: { name: string; amountPaisa: number }[]; totalPaisa: number } | null };
    return { kind: "fee_structure" as const, name: s.name, startDate: s.startDate, endDate: s.endDate, startDateBs: adToBsText(s.startDate), endDateBs: adToBsText(s.endDate), items: s.items, totalPaisa: s.totalPaisa, previous: s.previous };
  },
  async currentVersion(db, id) {
    return (await db.prepare("SELECT version FROM fee_structures WHERE id = ?1").bind(id).first<{ version: number }>())?.version ?? null;
  },
  onRequested: (db, id) => [
    db.prepare("UPDATE fee_structures SET status = 'waiting' WHERE id = ?1 AND status = 'draft' AND EXISTS (SELECT 1 FROM fee_items WHERE structure_id = ?1 AND is_active = 1)").bind(id),
  ],
  // A new version replaces the one in force in the same batch: the old one first (only while this one is waiting), then this one is
  // live (the last statement, which the engine's own decision rides on). The price corrections follow in `afterApproved`.
  onApproved: (db, id) => [
    db.prepare("UPDATE fee_structures SET status = 'superseded' WHERE id = (SELECT replaces_id FROM fee_structures WHERE id = ?1 AND status = 'waiting') AND status = 'live'").bind(id),
    db.prepare("UPDATE fee_structures SET status = 'live', live_at = ?2 WHERE id = ?1 AND status = 'waiting'").bind(id, now()),
  ],
  onResolved: (db, id) => [db.prepare("UPDATE fee_structures SET status = 'draft' WHERE id = ?1 AND status = 'waiting'").bind(id)],
  async afterApproved(db, auditKey, id) {
    const root = await db.prepare("SELECT r.public_id FROM fee_structures s JOIN fee_structures r ON r.id = COALESCE(s.root_id, s.id) WHERE s.id = ?1").bind(id).first<{ public_id: string }>();
    if (root) await applyPriceChanges(db, auditKey, { rootPublicId: root.public_id });
  },
};

// --- Editing an approved structure ------------------------------------------------------------------

/**
 * The Accountant asks to edit an approved structure, with a reason (D-172). The approved version stays in force. The
 * Principal decides the request; on approval a draft copy appears for the Accountant to edit and send for approval
 * again (the `fee_structure` kind, now on that version).
 */
export async function requestEdit(db: D1Database, key: string, actor: string, structureId: string, reason: string): Promise<Created> {
  const text = reason.trim();
  if (text.length < 3 || text.length > 500) return { ok: false, reason: "invalid", message: "Say why the structure should change, in 3 to 500 characters" };
  const publicId = newPublicId();
  try {
    const { applied } = await recordAudit(db, key, { action: "fees.structure.edit_requested", entityType: "fee_edit_request", entityPublicId: publicId, actorPublicId: actor, summary: "Edit of an approved fee structure asked for", after: { structureId, reason: text } }, [
      db
        .prepare(
          `INSERT INTO fee_edit_requests (public_id, structure_id, reason, requested_by_user_id, created_at)
           SELECT ?1, fs.id, ?3, u.id, ?4 FROM fee_structures fs, users u
            WHERE fs.public_id = ?2 AND fs.status = 'live' AND u.public_id = ?5 AND ${accountantFor(5, "fs.section_id")}
              AND NOT EXISTS (SELECT 1 FROM fee_structures o WHERE COALESCE(o.root_id, o.id) = COALESCE(fs.root_id, fs.id) AND o.status IN ('draft', 'waiting'))`,
        )
        .bind(publicId, structureId, text, now(), actor),
    ], { onlyIfLastChanged: true });
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "conflict" };
    throw error;
  }
  const sent = await requestApproval(db, key, actor, { kind: "fee_structure_edit", subjectId: publicId });
  if (sent.ok) return { ok: true, publicId: sent.publicId };
  // A send that fails closes the draft request, so it does not hold the structure's one open request.
  await db.prepare("UPDATE fee_edit_requests SET status = 'closed' WHERE public_id = ?1 AND status = 'draft'").bind(publicId).run();
  return { ok: false, reason: sent.reason === "conflict" ? "conflict" : "not_found" };
}

export const feeEditApprovalHandler: ApprovalHandler = {
  requesterSql: anyAccountant,
  async resolveId(db, publicId) {
    return (await db.prepare("SELECT id FROM fee_edit_requests WHERE public_id = ?1").bind(publicId).first<{ id: number }>())?.id ?? null;
  },
  async describe(db, id) {
    const [head, items] = await db.batch([
      db.prepare("SELECT r.public_id, r.reason, s.id AS structure_id, s.name, s.start_date, s.end_date FROM fee_edit_requests r JOIN fee_structures s ON s.id = r.structure_id WHERE r.id = ?1").bind(id),
      db.prepare("SELECT fi.name, fi.amount_paisa FROM fee_edit_requests r JOIN fee_items fi ON fi.structure_id = r.structure_id AND fi.is_active = 1 WHERE r.id = ?1 ORDER BY fi.id").bind(id),
    ]);
    const row = head!.results[0] as { public_id: string; reason: string; name: string; start_date: string; end_date: string } | undefined;
    if (!row) return null;
    const lines = (items!.results as unknown as { name: string; amount_paisa: number }[]).map((i) => ({ name: i.name, amountPaisa: i.amount_paisa }));
    const totalPaisa = lines.reduce((sum, i) => sum + i.amountPaisa, 0);
    return {
      snapshot: { name: row.name, startDate: row.start_date, endDate: row.end_date, reason: row.reason, items: lines, totalPaisa },
      summary: `Edit of fee structure "${row.name}" (now NPR ${formatNpr(totalPaisa)}): ${row.reason}`,
      subjectPublicId: row.public_id,
    };
  },
  async detail(db, id) {
    const described = await this.describe(db, id);
    if (!described) return null;
    const s = described.snapshot as { name: string; startDate: string; endDate: string; reason: string; items: { name: string; amountPaisa: number }[]; totalPaisa: number };
    return { kind: "fee_structure_edit" as const, name: s.name, startDateBs: adToBsText(s.startDate), endDateBs: adToBsText(s.endDate), reason: s.reason, items: s.items, totalPaisa: s.totalPaisa };
  },
  async currentVersion(db, id) {
    return (await db.prepare("SELECT s.version FROM fee_edit_requests r JOIN fee_structures s ON s.id = r.structure_id WHERE r.id = ?1").bind(id).first<{ version: number }>())?.version ?? null;
  },
  onRequested: (db, id) => [db.prepare("UPDATE fee_edit_requests SET status = 'pending' WHERE id = ?1 AND status = 'draft'").bind(id)],
  // Approving makes the draft copy of the version in force: the version, its lines, then the request is marked (the last statement).
  onApproved: (db, id) => [
    db
      .prepare(
        `INSERT INTO fee_structures (public_id, section_id, name, start_date, end_date, root_id, replaces_id, created_by_user_id, created_at)
         SELECT lower(hex(randomblob(16))), s.section_id, s.name, s.start_date, s.end_date, COALESCE(s.root_id, s.id), s.id, r.requested_by_user_id, ?2
           FROM fee_edit_requests r JOIN fee_structures s ON s.id = r.structure_id WHERE r.id = ?1 AND r.status = 'pending' AND s.status = 'live'`,
      )
      .bind(id, now()),
    db
      .prepare(
        `INSERT INTO fee_items (public_id, structure_id, name, amount_paisa, frequency, created_at)
         SELECT lower(hex(randomblob(16))), (SELECT n.id FROM fee_structures n WHERE n.replaces_id = r.structure_id AND n.status = 'draft'), fi.name, fi.amount_paisa, fi.frequency, ?2
           FROM fee_edit_requests r JOIN fee_items fi ON fi.structure_id = r.structure_id AND fi.is_active = 1
          WHERE r.id = ?1 AND r.status = 'pending' AND EXISTS (SELECT 1 FROM fee_structures n WHERE n.replaces_id = r.structure_id AND n.status = 'draft')
          ORDER BY fi.id`,
      )
      .bind(id, now()),
    db
      .prepare(
        `UPDATE fee_edit_requests SET status = 'approved', new_version_id = (SELECT n.id FROM fee_structures n WHERE n.replaces_id = fee_edit_requests.structure_id AND n.status = 'draft')
          WHERE id = ?1 AND status = 'pending' AND EXISTS (SELECT 1 FROM fee_structures n WHERE n.replaces_id = fee_edit_requests.structure_id AND n.status = 'draft')`,
      )
      .bind(id),
  ],
  onResolved: (db, id) => [db.prepare("UPDATE fee_edit_requests SET status = 'closed' WHERE id = ?1 AND status = 'pending'").bind(id)],
};

/** Gives up a draft edit of an approved structure: only a draft that replaces a live version. The approved version is untouched. */
export async function discardEdit(db: D1Database, key: string, actor: string, structureId: string): Promise<Done> {
  const outcome = await audited(db, key, { action: "fees.structure.edit_discarded", entityType: "fee_structure", entityPublicId: structureId, actorPublicId: actor, summary: "Draft edit of a fee structure discarded" }, [
    db.prepare(`UPDATE fee_structures SET status = 'discarded' WHERE public_id = ?2 AND status = 'draft' AND replaces_id IS NOT NULL AND ${accountantFor(1, "fee_structures.section_id")}`).bind(actor, structureId),
  ]);
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_found" };
}

// --- Linking to levels --------------------------------------------------------------------------------

export type LinkOutcome = { levelId: string; ok: true } | { levelId: string; ok: false; reason: "not_found" | "not_live" | "wrong_wing" | "conflict" | "ended" };
export type LinkResult = { ok: true; levels: LinkOutcome[]; charged: number; pending: boolean } | Failure;

/** The chain's first version (the "root"): what a link points at, so a newer live version is used at once. */
async function rootOf(db: D1Database, structureId: string): Promise<{ id: number; publicId: string } | null> {
  const row = await db
    .prepare("SELECT r.id, r.public_id FROM fee_structures s JOIN fee_structures r ON r.id = COALESCE(s.root_id, s.id) WHERE s.public_id = ?1")
    .bind(structureId)
    .first<{ id: number; public_id: string }>();
  return row ? { id: row.id, publicId: row.public_id } : null;
}

/**
 * Links an approved structure to levels, with no approval (the PM, 2026-10-17). Each level is its own audited change, so
 * one that cannot be linked (not its wing, already has a structure for those dates) does not stop the rest. Then the
 * students of the linked levels are charged, as many as one request may (the sweep makes the rest).
 */
export async function linkLevels(db: D1Database, key: string, actor: string, structureId: string, levelIds: readonly string[]): Promise<LinkResult> {
  const root = await rootOf(db, structureId);
  if (!root) return { ok: false, reason: "not_found" };
  const allowed = await db.prepare(`SELECT ${STRUCTURE_GUARD} AS ok`).bind(actor, structureId).first<{ ok: number }>();
  if (allowed?.ok !== 1) return { ok: false, reason: "not_found" };
  const levels: LinkOutcome[] = [];
  // A structure whose last day has passed charges no one (the PM, 2026-10-17): it is renewed, not linked again.
  const ends = await db.prepare("SELECT end_date FROM fee_structures WHERE id = ?1").bind(root.id).first<{ end_date: string }>();
  if (ends && ends.end_date < nepalDate(new Date())) return { ok: true, levels: [...new Set(levelIds)].map((levelId) => ({ levelId, ok: false as const, reason: "ended" as const })), charged: 0, pending: false };
  for (const levelId of [...new Set(levelIds)]) {
    const outcome = await audited(db, key, { action: "fees.structure.linked", entityType: "fee_structure", entityPublicId: root.publicId, actorPublicId: actor, summary: "Fee structure linked to a level", after: { levelId } }, [
      db
        .prepare(
          `INSERT INTO level_fee_structures (level_id, root_id, linked_by_user_id, linked_at)
           SELECT lv.id, ?2, u.id, ?4 FROM levels lv, users u WHERE lv.public_id = ?1 AND lv.is_active = 1 AND u.public_id = ?3`,
        )
        .bind(levelId, root.id, actor, now()),
    ]);
    levels.push(outcome === "done" ? { levelId, ok: true } : { levelId, ok: false, reason: outcome === "not_live" ? "not_live" : outcome === "wrong_wing" ? "wrong_wing" : outcome === "duplicate" ? "conflict" : "not_found" });
  }
  const charged = levels.some((l) => l.ok) ? await chargeLinked(db, key, { rootPublicId: root.publicId }) : { created: 0, pending: false };
  return { ok: true, levels, charged: charged.created, pending: charged.pending };
}

/** Removes a level's link. Refused once any student of the level, charged under it, has paid anything: it is in use. */
export async function unlinkLevel(db: D1Database, key: string, actor: string, structureId: string, levelId: string): Promise<Done> {
  const root = await rootOf(db, structureId);
  if (!root) return { ok: false, reason: "not_found" };
  const outcome = await audited(db, key, { action: "fees.structure.unlinked", entityType: "fee_structure", entityPublicId: root.publicId, actorPublicId: actor, summary: "Fee structure unlinked from a level", after: { levelId } }, [
    db
      .prepare(
        `DELETE FROM level_fee_structures WHERE root_id = ?2 AND level_id = (SELECT id FROM levels WHERE public_id = ?1)
            AND ${accountantFor(3, "(SELECT section_id FROM fee_structures WHERE id = level_fee_structures.root_id)")}`,
      )
      .bind(levelId, root.id, actor),
  ]);
  if (outcome === "done") return { ok: true };
  if (outcome === "in_use") return { ok: false, reason: "in_use" };
  return { ok: false, reason: "not_found" };
}

// --- Charging ------------------------------------------------------------------------------------------

/** How many ledger entries one run writes at most: each is an HMAC, and a request has a CPU limit. The sweep makes the rest. */
const MAX_ENTRIES_PER_RUN = 400;
/** How many entries go into one batch: each is a statement with its own hash. */
const CHUNK = 100;

export interface ChargeScope {
  /** Only this structure (its root's public id). */
  rootPublicId?: string;
  /** Only this enrollment (a student who has just joined). */
  enrollmentPublicId?: string;
}

interface Work {
  enrollment: string;
  created_at: string;
  root_public: string;
  actor: string;
  start_date: string;
  end_date: string;
  first_in_programme: number;
  version_id: number;
  root_id: number;
}

/**
 * Makes every missing charge for the students of linked levels, from the structure's live version (the PM, 2026-10-17:
 * charged automatically). Safe to run again at any time, and from anywhere: when a level is linked, when a student
 * joins, and by the sweep. A charge is attributed to the person who linked the level. Each line is one charge due on the
 * structure's start date (or the day a later student joined); a legacy line keeps its own billing schedule.
 */
export async function chargeLinked(db: D1Database, key: string, scope: ChargeScope = {}, limit = MAX_ENTRIES_PER_RUN): Promise<{ created: number; pending: boolean }> {
  const { results: work } = await db
    .prepare(
      `SELECT en.public_id AS enrollment, en.created_at, r.public_id AS root_public, lfu.public_id AS actor, r.start_date, r.end_date, live.id AS version_id, lf.root_id AS root_id,
              NOT EXISTS (SELECT 1 FROM enrollments e2 JOIN classes c2 ON c2.id = e2.class_id JOIN levels l2 ON l2.id = c2.level_id JOIN academic_years y2 ON y2.id = e2.academic_year_id
                           WHERE e2.student_id = en.student_id AND l2.programme_id = lv.programme_id AND y2.start_date < ay.start_date) AS first_in_programme
         FROM level_fee_structures lf
         JOIN fee_structures r ON r.id = lf.root_id
         JOIN fee_structures live ON COALESCE(live.root_id, live.id) = lf.root_id AND live.status = 'live'
         JOIN users lfu ON lfu.id = lf.linked_by_user_id AND lfu.is_active = 1
         JOIN levels lv ON lv.id = lf.level_id
         JOIN classes cl ON cl.level_id = lf.level_id AND cl.is_active = 1
         JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status <> 'closed'
         JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active'
        WHERE (?1 IS NULL OR r.public_id = ?1) AND (?2 IS NULL OR en.public_id = ?2)
        ORDER BY en.id`,
    )
    .bind(scope.rootPublicId ?? null, scope.enrollmentPublicId ?? null)
    .all<Work>();
  if (work.length === 0) return { created: 0, pending: false };

  const versions = [...new Set(work.map((w) => w.version_id))];
  const [lineRows, haveRows] = await db.batch([
    db.prepare("SELECT fi.public_id, fi.structure_id, fi.name, fi.amount_paisa, fi.frequency FROM fee_items fi WHERE fi.is_active = 1 AND fi.structure_id IN (SELECT value FROM json_each(?1)) ORDER BY fi.id").bind(JSON.stringify(versions)),
    db
      .prepare(
        `SELECT en.public_id AS enrollment, COALESCE(fv.root_id, fv.id) AS root, lower(fi.name) AS name, le.period
           FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN fee_items fi ON fi.id = le.fee_item_id JOIN fee_structures fv ON fv.id = fi.structure_id
          WHERE le.kind = 'charge' AND le.enrollment_id IN (SELECT id FROM enrollments WHERE public_id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(JSON.stringify([...new Set(work.map((w) => w.enrollment))])),
  ]);
  const lines = lineRows!.results as unknown as { public_id: string; structure_id: number; name: string; amount_paisa: number; frequency: Frequency }[];
  const have = new Set((haveRows!.results as unknown as { enrollment: string; root: number; name: string; period: string }[]).map((r) => `${r.enrollment}|${r.root}|${r.name}|${r.period}`));

  // What is missing, grouped by structure so each chunk is one audited write with one guard.
  const at = now();
  const byRoot = new Map<string, { actor: string; drafts: LedgerDraft[] }>();
  let total = 0;
  let cut = false;
  for (const w of work) {
    for (const line of lines.filter((l) => l.structure_id === w.version_id)) {
      // A structure is its own dates, not the term's (the PM, 2026-10-17); `bsYear` is only a fallback when there is no end date, so a date
      // beyond the verified BS calendar must not stop the run.
      const year = { bsYear: 0, startDate: w.start_date, endDate: w.end_date };
      // A student who joined by the structure's last day is charged under it, once it is linked and approved (one admitted early
      // included); one who joins after it ended is not (the PM, 2026-10-17): it is as if unlinked.
      if (line.frequency === "one_time" && nepalDate(new Date(w.created_at)) > w.end_date) continue;
      let schedule: ReturnType<typeof billingSchedule>;
      try {
        schedule = billingSchedule(line, year, { enrolledOn: nepalDate(new Date(w.created_at)), firstInProgramme: w.first_in_programme === 1 });
      } catch {
        continue; // an old-style monthly line over dates the calendar cannot convert yet: left for when it can
      }
      for (const charge of schedule) {
        // Billed under any version of this structure already (a line of an edited version is the same line, by its name).
        if (have.has(`${w.enrollment}|${w.root_id}|${line.name.toLowerCase()}|${charge.period}`)) continue;
        if (total >= limit) {
          cut = true;
          continue;
        }
        const group = byRoot.get(w.root_public) ?? { actor: w.actor, drafts: [] };
        group.drafts.push({ publicId: newPublicId(), enrollmentPublicId: w.enrollment, kind: "charge", amountPaisa: line.amount_paisa, feeItemPublicId: line.public_id, period: charge.period, dueOn: charge.dueOn, memo: line.name, actorPublicId: w.actor, createdAt: at });
        byRoot.set(w.root_public, group);
        total += 1;
      }
    }
  }

  let created = 0;
  for (const [rootPublic, { actor, drafts }] of byRoot) {
    const guard = `EXISTS (SELECT 1 FROM level_fee_structures lf WHERE lf.root_id = (SELECT id FROM fee_structures WHERE public_id = ?16) AND lf.level_id = (SELECT level_id FROM classes WHERE id = en.class_id))`;
    for (let from = 0; from < drafts.length; from += CHUNK) {
      const chunk = drafts.slice(from, from + CHUNK);
      const outcome = await writeMoney(
        db,
        key,
        { action: "fees.charges.generated", entityType: "fee_structure", entityPublicId: rootPublic, actorPublicId: actor, summary: `${chunk.length} charges made`, after: { count: chunk.length, automatic: true } },
        async (head) => (await ledgerInserts(db, key, head, chunk, { guard, guardBinds: [rootPublic] })).statements,
      );
      if (outcome === "done") created += chunk.length;
      else if (outcome === "duplicate") {
        // Another run made some of these a moment ago: what is still missing is made on the next run, which the sweep does.
        cut = true;
      } else if (outcome === "year_closed" || outcome === "not_applied") cut = true;
      else throw new Error("The ledger refused a charge."); // "rejected": a constraint, which another try would only meet again
    }
  }
  return { created, pending: cut };
}

// --- Price changes ------------------------------------------------------------------------------------

/**
 * When an edited version of a structure goes live (D-172), what each student was billed for a line is brought to the new
 * price, by new ledger entries (the ledger is never rewritten): a price that went down makes a discount entry for the
 * difference (a student who had paid in full then shows a credit); one that went up makes an extra charge for it, due
 * on the day it was due or the day the version went live. The Principal's approval of the version covers it; nothing here
 * asks again. It is worked out from the ledger each time, so it is safe to repeat, and it picks up where it stopped: it is
 * run when the version is approved and by the 5-minute sweep, at most `limit` entries each time. Only plain lines are
 * corrected; a line of a structure from before D-172 (monthly, a term, the course) keeps its own schedule.
 */
export async function applyPriceChanges(db: D1Database, key: string, scope: { rootPublicId?: string } = {}, limit = MAX_ENTRIES_PER_RUN): Promise<{ created: number; pending: boolean }> {
  const { results: versions } = await db
    .prepare(
      `SELECT v.id AS version_id, v.public_id AS version_public, v.live_at, r.id AS root_id, r.public_id AS root_public, cu.public_id AS actor
         FROM fee_structures v JOIN fee_structures r ON r.id = v.root_id JOIN users cu ON cu.id = v.created_by_user_id
        WHERE v.status = 'live' AND v.replaces_id IS NOT NULL AND (?1 IS NULL OR r.public_id = ?1)
          AND EXISTS (SELECT 1 FROM level_fee_structures lf WHERE lf.root_id = r.id)`,
    )
    .bind(scope.rootPublicId ?? null)
    .all<{ version_id: number; version_public: string; live_at: string; root_id: number; root_public: string; actor: string }>();
  let created = 0;
  let total = 0;
  let cut = false;
  for (const v of versions) {
    const [lineRows, billedRows, discountRows] = await db.batch([
      db.prepare("SELECT public_id, name, amount_paisa FROM fee_items WHERE structure_id = ?1 AND is_active = 1 AND frequency = 'one_time' ORDER BY id").bind(v.version_id),
      db
        .prepare(
          `SELECT en.public_id AS enrollment, lower(fi.name) AS name, SUM(le.amount_paisa) AS billed, MAX(le.due_on) AS due
             FROM ledger_entries le JOIN fee_items fi ON fi.id = le.fee_item_id JOIN fee_structures fv ON fv.id = fi.structure_id
             JOIN enrollments en ON en.id = le.enrollment_id JOIN academic_years ay ON ay.id = en.academic_year_id
            WHERE le.kind = 'charge' AND fi.frequency = 'one_time' AND COALESCE(fv.root_id, fv.id) = ?1 AND ay.status <> 'closed'
              AND NOT EXISTS (SELECT 1 FROM fee_account_closures fc WHERE fc.enrollment_id = en.id)
            GROUP BY le.enrollment_id, lower(fi.name) ORDER BY le.enrollment_id`,
        )
        .bind(v.root_id),
      // The corrections already made for this structure's lines (a discount entry's source is "version:enrollment:name").
      db
        .prepare(
          `SELECT en.public_id AS enrollment, substr(le.source_public_id, 67) AS name, SUM(le.amount_paisa) AS amount
             FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id
            WHERE le.kind = 'discount' AND le.source_type = 'price_change'
              AND substr(le.source_public_id, 1, 32) IN (SELECT public_id FROM fee_structures WHERE COALESCE(root_id, id) = ?1)
            GROUP BY le.enrollment_id, substr(le.source_public_id, 67)`,
        )
        .bind(v.root_id),
    ]);
    const lines = new Map((lineRows!.results as unknown as { public_id: string; name: string; amount_paisa: number }[]).map((l) => [l.name.toLowerCase(), l]));
    const corrected = new Map((discountRows!.results as unknown as { enrollment: string; name: string; amount: number }[]).map((r) => [`${r.enrollment}|${r.name}`, r.amount]));
    const liveOn = nepalDate(new Date(v.live_at));
    const at = now();
    const drafts: LedgerDraft[] = [];
    for (const row of billedRows!.results as unknown as { enrollment: string; name: string; billed: number; due: string }[]) {
      const line = lines.get(row.name);
      if (!line) continue; // a line this version no longer has: what was billed stands
      const diff = line.amount_paisa - (row.billed + (corrected.get(`${row.enrollment}|${row.name}`) ?? 0));
      if (diff === 0) continue;
      if (total >= limit) {
        cut = true;
        continue;
      }
      total += 1;
      drafts.push(
        diff < 0
          ? { publicId: newPublicId(), enrollmentPublicId: row.enrollment, kind: "discount", amountPaisa: diff, sourceType: "price_change", sourcePublicId: `${v.version_public}:${row.enrollment}:${row.name}`, memo: `Price change: ${line.name}`, actorPublicId: v.actor, createdAt: at }
          : { publicId: newPublicId(), enrollmentPublicId: row.enrollment, kind: "charge", amountPaisa: diff, feeItemPublicId: line.public_id, period: "once", dueOn: row.due > liveOn ? row.due : liveOn, memo: `Price change: ${line.name}`, actorPublicId: v.actor, createdAt: at },
      );
    }
    const guard = "EXISTS (SELECT 1 FROM fee_structures lv WHERE lv.public_id = ?16 AND lv.status = 'live')";
    for (let from = 0; from < drafts.length; from += CHUNK) {
      const chunk = drafts.slice(from, from + CHUNK);
      const outcome = await writeMoney(
        db,
        key,
        { action: "fees.price_changes.applied", entityType: "fee_structure", entityPublicId: v.root_public, actorPublicId: v.actor, summary: `${chunk.length} price changes applied`, after: { count: chunk.length, version: v.version_public } },
        async (head) => (await ledgerInserts(db, key, head, chunk, { guard, guardBinds: [v.version_public] })).statements,
      );
      if (outcome === "done") created += chunk.length;
      else if (outcome === "duplicate" || outcome === "year_closed") cut = true; // the next run reads the ledger again
      else if (outcome === "rejected") throw new Error("The ledger refused a price change.");
    }
  }
  return { created, pending: cut };
}

// --- Reads --------------------------------------------------------------------------------------------

interface SummaryRow {
  editing: number;
  public_id: string;
  status: "draft" | "waiting" | "live" | "superseded";
  name: string;
  start_date: string;
  end_date: string;
  section_key: string;
  levels_linked: number;
}

/** One row for each structure (its chain of versions): the version in force, else the one being drafted, else the newest. */
const SUMMARY = `v.public_id, v.status, (v.replaces_id IS NOT NULL AND v.status IN ('draft','waiting')) AS editing, r.name, r.start_date, r.end_date, s.key AS section_key, (SELECT COUNT(*) FROM level_fee_structures x WHERE x.root_id = r.id) AS levels_linked
                   FROM fee_structures r JOIN sections s ON s.id = r.section_id
                   JOIN fee_structures v ON v.id = (SELECT p.id FROM fee_structures p WHERE COALESCE(p.root_id, p.id) = r.id
                                                      AND p.status <> 'discarded' ORDER BY (p.status IN ('draft', 'waiting')) DESC, (p.status = 'live') DESC, p.id DESC LIMIT 1)
                  WHERE r.root_id IS NULL`;

async function totals(db: D1Database, versionIds: string[]): Promise<Map<string, number>> {
  if (versionIds.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT fs.public_id, fi.amount_paisa, fi.frequency, fs.start_date, fs.end_date FROM fee_items fi JOIN fee_structures fs ON fs.id = fi.structure_id
        WHERE fi.is_active = 1 AND fs.public_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(versionIds))
    .all<{ public_id: string; amount_paisa: number; frequency: Frequency; start_date: string; end_date: string }>();
  const map = new Map<string, number>();
  for (const r of results) map.set(r.public_id, (map.get(r.public_id) ?? 0) + yearlyAmount({ frequency: r.frequency, amountPaisa: r.amount_paisa }, monthsOf(r.start_date, r.end_date)));
  return map;
}

/** The structures in the person's wings, newest period first. */
export async function listStructures(db: D1Database, grant: Grant): Promise<FeeStructureList> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY} AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))) ORDER BY r.start_date DESC, r.name`)
    .bind(sectionFilter(grant))
    .all<SummaryRow>();
  const sums = await totals(db, results.map((r) => r.public_id));
  const today = nepalDate(new Date());
  return {
    structures: results.map((r) => ({
      id: r.public_id,
      name: r.name,
      sectionKey: r.section_key,
      startDate: r.start_date,
      endDate: r.end_date,
      startDateBs: adToBsText(r.start_date),
      endDateBs: adToBsText(r.end_date),
      status: r.status === "superseded" ? "live" : r.status,
      totalPaisa: sums.get(r.public_id) ?? 0,
      levelsLinked: r.levels_linked,
      ended: r.end_date < today,
      editing: r.editing === 1,
    })),
  };
}

export async function getStructure(db: D1Database, grant: Grant, structureId: string): Promise<FeeStructure | null> {
  // Any version's id finds its structure; what is shown is the version in force (or being drafted).
  const root = await rootOf(db, structureId);
  if (!root) return null;
  const [head, linked, force, asked] = await db.batch([
    db.prepare(`SELECT ${SUMMARY} AND r.id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`).bind(root.id, sectionFilter(grant)),
    db
      .prepare(
        `SELECT lv.public_id AS level_id, pv.name AS programme_name, lv.name AS level_name,
                (SELECT COUNT(*) FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN academic_years ay ON ay.id = cl.academic_year_id
                  WHERE cl.level_id = lv.id AND en.status = 'active' AND ay.status <> 'closed') AS students
           FROM level_fee_structures lf JOIN levels lv ON lv.id = lf.level_id JOIN programmes pv ON pv.id = lv.programme_id
          WHERE lf.root_id = ?1 ORDER BY pv.ordering, lv.ordinal`,
      )
      .bind(root.id),
    db.prepare("SELECT l.public_id, (SELECT COALESCE(SUM(fi.amount_paisa), 0) FROM fee_items fi WHERE fi.structure_id = l.id AND fi.is_active = 1) AS total FROM fee_structures l WHERE COALESCE(l.root_id, l.id) = ?1 AND l.status = 'live'").bind(root.id),
    db.prepare("SELECT EXISTS (SELECT 1 FROM fee_edit_requests r JOIN fee_structures s ON s.id = r.structure_id WHERE COALESCE(s.root_id, s.id) = ?1 AND r.status IN ('draft', 'pending')) AS asked").bind(root.id),
  ]);
  const row = head!.results[0] as SummaryRow | undefined;
  if (!row) return null;
  const { results: items } = await db
    .prepare("SELECT fi.public_id, fi.name, fi.amount_paisa, fi.frequency FROM fee_items fi JOIN fee_structures fs ON fs.id = fi.structure_id WHERE fs.public_id = ?1 AND fi.is_active = 1 ORDER BY fi.id")
    .bind(row.public_id)
    .all<{ public_id: string; name: string; amount_paisa: number; frequency: Frequency }>();
  const months = monthsOf(row.start_date, row.end_date);
  return {
    id: row.public_id,
    name: row.name,
    sectionKey: row.section_key,
    startDate: row.start_date,
    endDate: row.end_date,
    startDateBs: adToBsText(row.start_date),
    endDateBs: adToBsText(row.end_date),
    status: row.status === "superseded" ? "live" : row.status,
    totalPaisa: items.reduce((sum, i) => sum + yearlyAmount({ frequency: i.frequency, amountPaisa: i.amount_paisa }, months), 0),
    levelsLinked: row.levels_linked,
    ended: row.end_date < nepalDate(new Date()),
    editing: row.editing === 1,
    inForce: row.editing === 1 ? ((rows) => (rows ? { id: rows.public_id, totalPaisa: rows.total } : null))(force!.results[0] as { public_id: string; total: number } | undefined) : null,
    editRequested: (asked!.results[0] as { asked: number }).asked === 1,
    items: items.map((i) => ({ id: i.public_id, name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency })),
    levels: (linked!.results as unknown as { level_id: string; programme_name: string; level_name: string; students: number }[]).map((l) => ({ levelId: l.level_id, programmeName: l.programme_name, levelName: l.level_name, students: l.students })),
  };
}
