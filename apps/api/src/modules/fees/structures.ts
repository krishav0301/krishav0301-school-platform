import { recordAudit } from "../../core/audit";
import { nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { formatNpr } from "./money";
import type { Grant } from "../../core/permissions";
import { requestApproval, type ApprovalHandler } from "../approvals/service";
import { accountantFor, anyAccountant, levelSection, structureSection } from "./guard";
import { ledgerInserts, writeMoney, type LedgerDraft } from "./ledger";
import { billingSchedule, termMonths, yearlyAmount, type Frequency } from "./policy";
import { ChangeFeeItemSchema, NewFeeItemSchema, type ChangeFeeItem, type FeeStructure, type FeeStructureList, type NewFeeItem } from "./schema";

/**
 * Fee structures (D-075): one per academic year and programme level, drafted by the Accountant, approved by an Admin
 * through the approvals engine, then live and fixed. Charges are made from a live structure by the billing-schedule
 * policy, idempotently: the ledger's own unique index allows one charge per student, item and period.
 */

export type Failure = { ok: false; reason: "not_found" | "conflict" | "not_draft" | "not_live" | "year_closed" | "not_allowed" } | { ok: false; reason: "invalid"; message: string };
export type Created = { ok: true; publicId: string } | Failure;
export type Done = { ok: true } | Failure;

const now = () => new Date().toISOString();
const sectionFilter = (grant: Grant): string | null => (grant.institution ? null : JSON.stringify(grant.sections));

async function audited(db: D1Database, key: string, event: Parameters<typeof recordAudit>[2], statements: D1PreparedStatement[]): Promise<"done" | "not_applied" | "duplicate" | "not_draft" | "year_closed"> {
  try {
    const { applied } = await recordAudit(db, key, event, statements, { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    if (/only a draft fee structure/i.test(message)) return "not_draft";
    if (/academic year is closed/i.test(message)) return "year_closed";
    throw error;
  }
}

/** How many BS months a term spans: what a monthly item is charged for (D-110). Twelve if the days cannot be converted. */
function monthsOf(startDate: string, endDate: string): number {
  try {
    return termMonths(startDate, endDate).length;
  } catch {
    return 12;
  }
}

// --- Drafting ------------------------------------------------------------------------------------

export async function createStructure(db: D1Database, key: string, actor: string, levelId: string): Promise<Created> {
  const publicId = newPublicId();
  const outcome = await audited(db, key, { action: "fees.structure.created", entityType: "fee_structure", entityPublicId: publicId, actorPublicId: actor, summary: "Fee structure drafted", after: { levelId } }, [
    db
      .prepare(
        `INSERT INTO fee_structures (public_id, academic_year_id, level_id, created_by_user_id, created_at)
         SELECT ?1, ay.id, lv.id, u.id, ?4
           FROM levels lv JOIN term_levels tl ON tl.level_id = lv.id JOIN academic_years ay ON ay.id = tl.academic_year_id AND ay.status <> 'closed', users u
          WHERE lv.public_id = ?2 AND lv.is_active = 1 AND u.public_id = ?3 AND ${accountantFor(3, levelSection(2))}`,
      )
      .bind(publicId, levelId, actor, now()),
  ]);
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_found" };
}

/** The structure's own guard: this actor is the Accountant for its section. `?1` the actor, `?2` the structure's public id. */
const STRUCTURE_GUARD = accountantFor(1, structureSection("(SELECT id FROM fee_structures WHERE public_id = ?2)"));

export async function addItem(db: D1Database, key: string, actor: string, structureId: string, input: NewFeeItem): Promise<Created> {
  const parsed = NewFeeItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const publicId = newPublicId();
  const outcome = await audited(db, key, { action: "fees.item.added", entityType: "fee_structure", entityPublicId: structureId, actorPublicId: actor, summary: `Fee item added: ${parsed.data.name}`, after: parsed.data }, [
    db
      .prepare(
        `INSERT INTO fee_items (public_id, structure_id, name, amount_paisa, frequency, created_at)
         SELECT ?3, fs.id, ?4, ?5, ?6, ?7 FROM fee_structures fs WHERE fs.public_id = ?2 AND ${STRUCTURE_GUARD}`,
      )
      .bind(actor, structureId, publicId, parsed.data.name, parsed.data.amountPaisa, parsed.data.frequency, now()),
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
  const outcome = await audited(db, key, { action: "fees.item.changed", entityType: "fee_item", entityPublicId: itemId, actorPublicId: actor, summary: "Fee item changed", after: c }, [
    db
      .prepare(
        `UPDATE fee_items SET name = COALESCE(?3, name), amount_paisa = COALESCE(?4, amount_paisa), frequency = COALESCE(?5, frequency), is_active = COALESCE(?6, is_active)
          WHERE public_id = ?2 AND ${accountantFor(1, structureSection("fee_items.structure_id"))}`,
      )
      .bind(actor, itemId, c.name ?? null, c.amountPaisa ?? null, c.frequency ?? null, c.isActive === undefined ? null : c.isActive ? 1 : 0),
  ]);
  if (outcome === "done") return { ok: true };
  if (outcome === "not_draft") return { ok: false, reason: "not_draft" };
  return { ok: false, reason: "not_found" };
}

/** Sends a draft for Admin approval, through the engine. The actor must be the Accountant for its section. */
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

const FREQUENCY_WORD: Record<Frequency, string> = { one_time: "once", monthly: "a month", yearly: "a term", whole_course: "for the course" };

export const feeStructureApprovalHandler: ApprovalHandler = {
  requesterSql: anyAccountant,
  async resolveId(db, publicId) {
    return (await db.prepare("SELECT id FROM fee_structures WHERE public_id = ?1").bind(publicId).first<{ id: number }>())?.id ?? null;
  },
  async describe(db, id) {
    const [head, items] = await db.batch([
      db.prepare(
        `SELECT fs.public_id, ay.label AS year_label, ay.start_date, ay.end_date, pv.name AS programme_name, lv.name AS level_name
           FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id JOIN levels lv ON lv.id = fs.level_id JOIN programmes pv ON pv.id = lv.programme_id
          WHERE fs.id = ?1`,
      ).bind(id),
      db.prepare("SELECT name, amount_paisa, frequency FROM fee_items WHERE structure_id = ?1 AND is_active = 1 ORDER BY id").bind(id),
    ]);
    const row = head!.results[0] as { public_id: string; year_label: string; start_date: string; end_date: string; programme_name: string; level_name: string } | undefined;
    if (!row) return null;
    const months = monthsOf(row.start_date, row.end_date);
    const lines = (items!.results as unknown as { name: string; amount_paisa: number; frequency: Frequency }[]).map((i) => ({ name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency }));
    const yearlyTotalPaisa = lines.reduce((s, i) => s + yearlyAmount(i, months), 0);
    // The Admin decides from this line, so it says what is being approved (found by the year test, D-084).
    const itemWords = lines.map((i) => `${i.name} NPR ${formatNpr(i.amountPaisa)} ${FREQUENCY_WORD[i.frequency]}`).join("; ");
    return {
      snapshot: { year: row.year_label, programme: row.programme_name, level: row.level_name, items: lines, yearlyTotalPaisa },
      summary: `Fee structure: ${row.programme_name} ${row.level_name}, ${row.year_label}: ${itemWords}. NPR ${formatNpr(yearlyTotalPaisa)} for the term`,
      subjectPublicId: row.public_id,
    };
  },
  /** Every fee item and the yearly total, as the structure stands now (D-102). */
  async detail(db, id) {
    const described = await this.describe(db, id);
    if (!described) return null;
    const s = described.snapshot as { year: string; programme: string; level: string; items: { name: string; amountPaisa: number; frequency: Frequency }[]; yearlyTotalPaisa: number };
    return { kind: "fee_structure" as const, programme: s.programme, level: s.level, year: s.year, items: s.items, yearlyTotalPaisa: s.yearlyTotalPaisa };
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

// --- Charges ----------------------------------------------------------------------------------------

export type GenerateResult = { ok: true; created: number } | Failure;

/** How many charges go into one batch: each is a statement with its own hash. */
const CHUNK = 100;

/**
 * Makes every missing charge for the active students of one class of the structure's level, from the live structure.
 * Safe to run again at any time: it makes only what is missing, so a student admitted later is billed on the next run.
 */
export async function generateCharges(db: D1Database, key: string, actor: string, structureId: string, classId: string, today = nepalDate(new Date())): Promise<GenerateResult> {
  const [head, items] = await db.batch([
    db
      .prepare(
        `SELECT fs.status, ay.bs_year, ay.start_date, ay.end_date, ay.status AS year_status, cl.id AS class_id, lv.programme_id, ${STRUCTURE_GUARD} AS allowed
           FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id JOIN levels lv ON lv.id = fs.level_id
           JOIN classes cl ON cl.level_id = fs.level_id AND cl.academic_year_id = fs.academic_year_id AND cl.public_id = ?3
          WHERE fs.public_id = ?2`,
      )
      .bind(actor, structureId, classId),
    db.prepare("SELECT fi.public_id, fi.name, fi.amount_paisa, fi.frequency FROM fee_items fi JOIN fee_structures fs ON fs.id = fi.structure_id WHERE fs.public_id = ?1 AND fi.is_active = 1 ORDER BY fi.id").bind(structureId),
  ]);
  const s = head!.results[0] as { status: string; bs_year: number; start_date: string; end_date: string; year_status: string; class_id: number; programme_id: number; allowed: number } | undefined;
  if (!s || s.allowed !== 1) return { ok: false, reason: "not_found" };
  if (s.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (s.status !== "live") return { ok: false, reason: "not_live" };
  const lines = items!.results as unknown as { public_id: string; name: string; amount_paisa: number; frequency: Frequency }[];

  // What is missing, read once; then written a chunk at a time. Read again only when another run made some of the same
  // charges first (a "duplicate"), so the reads do not grow with the number of chunks (D-108).
  const plan = async (): Promise<LedgerDraft[]> => {
    // Who is in the class, whether this is their first year of the programme, and what they are already charged.
    const [students, existing] = await db.batch([
      db
        .prepare(
          `SELECT en.public_id, en.created_at,
                  NOT EXISTS (SELECT 1 FROM enrollments e2 JOIN classes c2 ON c2.id = e2.class_id JOIN levels l2 ON l2.id = c2.level_id JOIN academic_years y2 ON y2.id = e2.academic_year_id
                               WHERE e2.student_id = en.student_id AND l2.programme_id = ?2 AND y2.start_date < (SELECT start_date FROM academic_years WHERE id = en.academic_year_id)) AS first_in_programme
             FROM enrollments en WHERE en.class_id = ?1 AND en.status = 'active' ORDER BY en.id`,
        )
        .bind(s.class_id, s.programme_id),
      db
        .prepare(
          `SELECT en.public_id AS enrollment, fi.public_id AS item, le.period FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN fee_items fi ON fi.id = le.fee_item_id
            WHERE le.kind = 'charge' AND en.class_id = ?1`,
        )
        .bind(s.class_id),
    ]);
    const have = new Set((existing!.results as unknown as { enrollment: string; item: string; period: string }[]).map((r) => `${r.enrollment}|${r.item}|${r.period}`));
    const at = now();
    const drafts: LedgerDraft[] = [];
    for (const st of students!.results as unknown as { public_id: string; created_at: string; first_in_programme: number }[]) {
      for (const item of lines) {
        for (const charge of billingSchedule(item, { bsYear: s.bs_year, startDate: s.start_date, endDate: s.end_date }, { enrolledOn: nepalDate(new Date(st.created_at)), firstInProgramme: st.first_in_programme === 1 })) {
          if (have.has(`${st.public_id}|${item.public_id}|${charge.period}`)) continue;
          drafts.push({
            publicId: newPublicId(),
            enrollmentPublicId: st.public_id,
            kind: "charge",
            amountPaisa: item.amount_paisa,
            feeItemPublicId: item.public_id,
            period: charge.period,
            dueOn: charge.dueOn,
            memo: item.name,
            actorPublicId: actor,
            createdAt: at,
          });
        }
      }
    }
    return drafts;
  };

  const guard = `EXISTS (SELECT 1 FROM fee_structures gs WHERE gs.public_id = ?17 AND gs.status = 'live') AND ${accountantFor(16, structureSection("(SELECT id FROM fee_structures WHERE public_id = ?17)"))}`;
  let created = 0;
  let drafts = await plan();
  let from = 0;
  // Every chunk either lands, or meets charges another run made, after which the plan is smaller; the bound only stops
  // a fault from looping, and says so rather than reporting a partial run as done.
  for (let attempt = 0; from < drafts.length; attempt++) {
    if (attempt > 1000) throw new Error("Making charges did not finish: the plan kept meeting charges made elsewhere.");
    const chunk = drafts.slice(from, from + CHUNK);
    const outcome = await writeMoney(
      db,
      key,
      { action: "fees.charges.generated", entityType: "fee_structure", entityPublicId: structureId, actorPublicId: actor, summary: `${chunk.length} charges made`, after: { classId, count: chunk.length, today } },
      async (ledgerHead) => (await ledgerInserts(db, key, ledgerHead, chunk, { guard, guardBinds: [actor, structureId] })).statements,
    );
    if (outcome === "done") {
      created += chunk.length;
      from += chunk.length;
    } else if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
    else if (outcome === "not_applied") return { ok: false, reason: "not_found" };
    else if (outcome === "duplicate") {
      // Another run made some of these a moment ago: what is still missing is read again.
      drafts = await plan();
      from = 0;
    } else throw new Error("The ledger refused a charge."); // "rejected": a constraint, which another try would only meet again

  }
  return { ok: true, created };
}

// --- Reads --------------------------------------------------------------------------------------------

interface SummaryRow {
  public_id: string;
  status: "draft" | "waiting" | "live";
  year_label: string;
  start_date: string;
  end_date: string;
  programme_name: string;
  level_name: string;
  section_key: string;
  level_id: string;
}
const SUMMARY = `fs.public_id, fs.status, ay.label AS year_label, ay.start_date, ay.end_date, pv.name AS programme_name, lv.name AS level_name, s.key AS section_key, lv.public_id AS level_id
                   FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id JOIN levels lv ON lv.id = fs.level_id
                   JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id`;

async function totals(db: D1Database, structureIds: string[]): Promise<Map<string, number>> {
  if (structureIds.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT fs.public_id, fi.amount_paisa, fi.frequency, ay.start_date, ay.end_date FROM fee_items fi JOIN fee_structures fs ON fs.id = fi.structure_id
         JOIN academic_years ay ON ay.id = fs.academic_year_id WHERE fi.is_active = 1 AND fs.public_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(structureIds))
    .all<{ public_id: string; amount_paisa: number; frequency: Frequency; start_date: string; end_date: string }>();
  const map = new Map<string, number>();
  for (const r of results) map.set(r.public_id, (map.get(r.public_id) ?? 0) + yearlyAmount({ frequency: r.frequency, amountPaisa: r.amount_paisa }, monthsOf(r.start_date, r.end_date)));
  return map;
}

/** The open terms' structures in the person's sections (D-110: a draft term's structure can be prepared ahead). */
export async function listStructures(db: D1Database, grant: Grant): Promise<FeeStructureList> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY} WHERE ay.status <> 'closed' AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))) ORDER BY s.ordering, pv.ordering, lv.ordinal`)
    .bind(sectionFilter(grant))
    .all<SummaryRow>();
  const sums = await totals(db, results.map((r) => r.public_id));
  return {
    structures: results.map((r) => ({ id: r.public_id, levelId: r.level_id, status: r.status, yearLabel: r.year_label, programmeName: r.programme_name, levelName: r.level_name, sectionKey: r.section_key, yearlyTotalPaisa: sums.get(r.public_id) ?? 0 })),
  };
}

export async function getStructure(db: D1Database, grant: Grant, structureId: string): Promise<FeeStructure | null> {
  const [head, items, classes] = await db.batch([
    db.prepare(`SELECT ${SUMMARY} WHERE fs.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`).bind(structureId, sectionFilter(grant)),
    db.prepare("SELECT fi.public_id, fi.name, fi.amount_paisa, fi.frequency FROM fee_items fi JOIN fee_structures fs ON fs.id = fi.structure_id WHERE fs.public_id = ?1 AND fi.is_active = 1 ORDER BY fi.id").bind(structureId),
    db
      .prepare(
        `SELECT cl.public_id, cl.label, (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active') AS students
           FROM classes cl JOIN fee_structures fs ON fs.level_id = cl.level_id AND fs.academic_year_id = cl.academic_year_id
          WHERE fs.public_id = ?1 AND cl.is_active = 1 ORDER BY cl.label`,
      )
      .bind(structureId),
  ]);
  const row = head!.results[0] as SummaryRow | undefined;
  if (!row) return null;
  const lines = (items!.results as unknown as { public_id: string; name: string; amount_paisa: number; frequency: Frequency }[]).map((i) => ({ id: i.public_id, name: i.name, amountPaisa: i.amount_paisa, frequency: i.frequency }));
  return {
    id: row.public_id,
    status: row.status,
    yearLabel: row.year_label,
    programmeName: row.programme_name,
    levelName: row.level_name,
    sectionKey: row.section_key,
    levelId: row.level_id,
    yearlyTotalPaisa: lines.reduce((sum, i) => sum + yearlyAmount(i, monthsOf(row.start_date, row.end_date)), 0),
    items: lines,
    classes: (classes!.results as unknown as { public_id: string; label: string; students: number }[]).map((c) => ({ id: c.public_id, label: c.label, students: c.students })),
  };
}
