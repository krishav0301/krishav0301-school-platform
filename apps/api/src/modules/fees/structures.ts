import { recordAudit } from "../../core/audit";
import { adToBs, adToBsText, nepalDate } from "../../core/dates";
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
    const [head, items] = await db.batch([
      db.prepare("SELECT fs.public_id, fs.name, fs.start_date, fs.end_date FROM fee_structures fs WHERE fs.id = ?1").bind(id),
      db.prepare("SELECT name, amount_paisa, frequency FROM fee_items WHERE structure_id = ?1 AND is_active = 1 ORDER BY id").bind(id),
    ]);
    const row = head!.results[0] as { public_id: string; name: string; start_date: string; end_date: string } | undefined;
    if (!row) return null;
    const months = monthsOf(row.start_date, row.end_date);
    const lines = (items!.results as unknown as { name: string; amount_paisa: number; frequency: Frequency }[]).map((i) => ({ name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency }));
    const totalPaisa = lines.reduce((s, i) => s + yearlyAmount(i, months), 0);
    // The Principal decides from this line, so it says what is being approved (found by the year test, D-084).
    const lineWords = lines.map((i) => `${i.name} NPR ${formatNpr(i.amountPaisa)}${FREQUENCY_WORD[i.frequency]}`).join("; ");
    const period = `${adToBsText(row.start_date) ?? row.start_date} to ${adToBsText(row.end_date) ?? row.end_date}`;
    return {
      snapshot: { name: row.name, startDate: row.start_date, endDate: row.end_date, items: lines, totalPaisa },
      summary: `Fee structure "${row.name}", ${period}: ${lineWords}. Total NPR ${formatNpr(totalPaisa)}`,
      subjectPublicId: row.public_id,
    };
  },
  /** Every line and the total, as the structure stands now (D-102). */
  async detail(db, id) {
    const described = await this.describe(db, id);
    if (!described) return null;
    const s = described.snapshot as { name: string; startDate: string; endDate: string; items: { name: string; amountPaisa: number; frequency: Frequency }[]; totalPaisa: number };
    return { kind: "fee_structure" as const, name: s.name, startDate: s.startDate, endDate: s.endDate, startDateBs: adToBsText(s.startDate), endDateBs: adToBsText(s.endDate), items: s.items, totalPaisa: s.totalPaisa };
  },
  async currentVersion(db, id) {
    return (await db.prepare("SELECT version FROM fee_structures WHERE id = ?1").bind(id).first<{ version: number }>())?.version ?? null;
  },
  onRequested: (db, id) => [
    db.prepare("UPDATE fee_structures SET status = 'waiting' WHERE id = ?1 AND status = 'draft' AND EXISTS (SELECT 1 FROM fee_items WHERE structure_id = ?1 AND is_active = 1)").bind(id),
  ],
  onApproved: (db, id) => [db.prepare("UPDATE fee_structures SET status = 'live', live_at = ?2 WHERE id = ?1 AND status = 'waiting'").bind(id, now())],
  onResolved: (db, id) => [db.prepare("UPDATE fee_structures SET status = 'draft' WHERE id = ?1 AND status = 'waiting'").bind(id)],
};

// --- Linking to levels --------------------------------------------------------------------------------

export type LinkOutcome = { levelId: string; ok: true } | { levelId: string; ok: false; reason: "not_found" | "not_live" | "wrong_wing" | "conflict" };
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
      `SELECT en.public_id AS enrollment, en.created_at, r.public_id AS root_public, lfu.public_id AS actor, r.start_date, r.end_date, live.id AS version_id,
              NOT EXISTS (SELECT 1 FROM enrollments e2 JOIN classes c2 ON c2.id = e2.class_id JOIN levels l2 ON l2.id = c2.level_id JOIN academic_years y2 ON y2.id = e2.academic_year_id
                           WHERE e2.student_id = en.student_id AND l2.programme_id = lv.programme_id AND y2.start_date < ay.start_date) AS first_in_programme
         FROM level_fee_structures lf
         JOIN fee_structures r ON r.id = lf.root_id
         JOIN fee_structures live ON COALESCE(live.root_id, live.id) = lf.root_id AND live.status = 'live'
         JOIN users lfu ON lfu.id = lf.linked_by_user_id AND lfu.is_active = 1
         JOIN levels lv ON lv.id = lf.level_id
         JOIN classes cl ON cl.level_id = lf.level_id AND cl.is_active = 1
         JOIN academic_years ay ON ay.id = cl.academic_year_id AND ay.status <> 'closed' AND ay.start_date <= r.end_date AND ay.end_date >= r.start_date
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
        `SELECT en.public_id AS enrollment, fi.public_id AS item, le.period FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN fee_items fi ON fi.id = le.fee_item_id
          WHERE le.kind = 'charge' AND le.enrollment_id IN (SELECT id FROM enrollments WHERE public_id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(JSON.stringify([...new Set(work.map((w) => w.enrollment))])),
  ]);
  const lines = lineRows!.results as unknown as { public_id: string; structure_id: number; name: string; amount_paisa: number; frequency: Frequency }[];
  const have = new Set((haveRows!.results as unknown as { enrollment: string; item: string; period: string }[]).map((r) => `${r.enrollment}|${r.item}|${r.period}`));

  // What is missing, grouped by structure so each chunk is one audited write with one guard.
  const at = now();
  const byRoot = new Map<string, { actor: string; drafts: LedgerDraft[] }>();
  let total = 0;
  let cut = false;
  for (const w of work) {
    for (const line of lines.filter((l) => l.structure_id === w.version_id)) {
      const year = { bsYear: adToBs(w.start_date).year, startDate: w.start_date, endDate: w.end_date };
      for (const charge of billingSchedule(line, year, { enrolledOn: nepalDate(new Date(w.created_at)), firstInProgramme: w.first_in_programme === 1 })) {
        if (have.has(`${w.enrollment}|${line.public_id}|${charge.period}`)) continue;
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

// --- Reads --------------------------------------------------------------------------------------------

interface SummaryRow {
  public_id: string;
  status: "draft" | "waiting" | "live" | "superseded";
  name: string;
  start_date: string;
  end_date: string;
  section_key: string;
  levels_linked: number;
}

/** One row for each structure (its chain of versions): the version in force, else the one being drafted, else the newest. */
const SUMMARY = `v.public_id, v.status, r.name, r.start_date, r.end_date, s.key AS section_key, (SELECT COUNT(*) FROM level_fee_structures x WHERE x.root_id = r.id) AS levels_linked
                   FROM fee_structures r JOIN sections s ON s.id = r.section_id
                   JOIN fee_structures v ON v.id = (SELECT p.id FROM fee_structures p WHERE COALESCE(p.root_id, p.id) = r.id
                                                     ORDER BY (p.status = 'live') DESC, (p.status IN ('draft', 'waiting')) DESC, p.id DESC LIMIT 1)
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
    })),
  };
}

export async function getStructure(db: D1Database, grant: Grant, structureId: string): Promise<FeeStructure | null> {
  // Any version's id finds its structure; what is shown is the version in force (or being drafted).
  const root = await rootOf(db, structureId);
  if (!root) return null;
  const [head, linked] = await db.batch([
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
    items: items.map((i) => ({ id: i.public_id, name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency })),
    levels: (linked!.results as unknown as { level_id: string; programme_name: string; level_name: string; students: number }[]).map((l) => ({ levelId: l.level_id, programmeName: l.programme_name, levelName: l.level_name, students: l.students })),
  };
}
