import { adToBs, isVerifiedBsYear } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { coordinatorForInstitution } from "./guard";
import { YearChangesSchema, YearInputSchema, type YearChanges, type YearInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/** The start day must fall in the BS year it belongs to, and that year's calendar must be verified (D-014). */
function calendarProblem(bsYear: number, startDate: string): string | null {
  if (!isVerifiedBsYear(bsYear)) return `The calendar for BS ${bsYear} has not been verified`;
  try {
    if (adToBs(startDate).year !== bsYear) return `The start day is not in BS ${bsYear}`;
  } catch {
    return "That start day is outside the verified calendar";
  }
  return null;
}

interface YearRow {
  bs_year: number;
  label: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
}

/** One round trip: is the person allowed, and what is the year now? */
async function inspectYear(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db.prepare("SELECT bs_year, label, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    year: (row!.results[0] as unknown as YearRow | undefined) ?? null,
  };
}

/** Adds a year as a draft. */
export async function createYear(db: D1Database, auditKey: string, actor: string, input: YearInput, now: Date = new Date()): Promise<Created> {
  const parsed = YearInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const y = parsed.data;
  const problem = calendarProblem(y.bsYear, y.startDate);
  if (problem) return { ok: false, reason: "invalid", message: problem };

  const label = y.label ?? String(y.bsYear);
  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.created",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${label} added as a draft`,
      after: { bsYear: y.bsYear, label, startDate: y.startDate, endDate: y.endDate },
    },
    db
      .prepare(
        `INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'draft', ?6 WHERE ${coordinatorForInstitution(7)}`,
      )
      .bind(publicId, y.bsYear, label, y.startDate, y.endDate, now.toISOString(), actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}

/** Changes a draft year's label or days. What is sent is merged with what is there, and the whole is checked again. */
export async function updateYear(db: D1Database, auditKey: string, actor: string, publicId: string, changes: YearChanges): Promise<Done> {
  const parsedChanges = YearChangesSchema.safeParse(changes);
  if (!parsedChanges.success) return { ok: false, reason: "invalid", message: firstMessage(parsedChanges.error) };

  const { allowed, year } = await inspectYear(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!year) return { ok: false, reason: "not_found" };
  if (year.status !== "draft") return { ok: false, reason: "not_draft" };

  const before = { bsYear: year.bs_year, label: year.label, startDate: year.start_date, endDate: year.end_date };
  const c = parsedChanges.data;
  const merged = { bsYear: year.bs_year, label: c.label ?? year.label, startDate: c.startDate ?? year.start_date, endDate: c.endDate ?? year.end_date };
  const parsed = YearInputSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const problem = calendarProblem(merged.bsYear, merged.startDate);
  if (problem) return { ok: false, reason: "invalid", message: problem };
  if (JSON.stringify(merged) === JSON.stringify(before)) return { ok: true }; // nothing to change, nothing to record

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.updated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${merged.label} changed`,
      before,
      after: merged,
    },
    db
      .prepare(
        `UPDATE academic_years SET label = ?2, start_date = ?3, end_date = ?4
          WHERE public_id = ?1 AND status = 'draft' AND ${coordinatorForInstitution(5)}`,
      )
      .bind(publicId, merged.label, merged.startDate, merged.endDate, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };

  const again = await inspectYear(db, publicId, actor);
  if (!again.allowed) return { ok: false, reason: "not_allowed" };
  return again.year && again.year.status !== "draft" ? { ok: false, reason: "not_draft" } : { ok: false, reason: "not_allowed" };
}

/**
 * Makes a draft year the active one. Only one year is active at a time (closing a year is Phase 8), so this is
 * refused while another is. Two people doing it at once: one wins, the other is told another year is active.
 */
export async function activateYear(db: D1Database, auditKey: string, actor: string, publicId: string, now: Date = new Date()): Promise<Done> {
  const first = await inspectYear(db, publicId, actor);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.year) return { ok: false, reason: "not_found" };
  if (first.year.status !== "draft") return { ok: false, reason: "not_draft" };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.activated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${first.year.label} made the active year`,
      before: { status: "draft" },
      after: { status: "active", at: now.toISOString() },
    },
    db
      .prepare(
        `UPDATE academic_years SET status = 'active'
          WHERE public_id = ?1 AND status = 'draft'
            AND NOT EXISTS (SELECT 1 FROM academic_years WHERE status = 'active')
            AND ${coordinatorForInstitution(2)}`,
      )
      .bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "another_active" }; // the one-active index caught a race

  const second = await inspectYear(db, publicId, actor);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.year && second.year.status !== "draft" ? { ok: false, reason: "not_draft" } : { ok: false, reason: "another_active" };
}
