import { recordAudit, type AuditEventInput } from "../../core/audit";

export type Failure =
  | { ok: false; reason: "not_allowed" | "not_found" | "year_closed" | "conflict" | "not_draft" | "another_active" | "in_use" | "code_taken" | "code_locked" }
  | { ok: false; reason: "invalid"; message: string };
export type Done = { ok: true } | Failure;
export type Created = { ok: true; publicId: string } | Failure;

export const firstMessage = (error: { issues: { message: string }[] }): string => error.issues[0]?.message ?? "That is not valid";

/** What happened to one write. `not_applied`: the conditional SQL matched nothing (not allowed, missing, or a lost race). */
export type Outcome = "done" | "not_applied" | "duplicate" | "year_closed" | "check_failed";

/**
 * One change, possibly of several statements, and its audit entry, in one batch. The entry is written only if
 * the LAST statement changed a row, so a lost race or a failed re-check leaves no false entry. The database's
 * own refusals are turned into words.
 */
export async function write(db: D1Database, auditKey: string, event: AuditEventInput, statement: D1PreparedStatement | D1PreparedStatement[]): Promise<Outcome> {
  try {
    const { applied } = await recordAudit(db, auditKey, event, Array.isArray(statement) ? statement : [statement], { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return "year_closed";
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    if (/CHECK constraint failed/i.test(message)) return "check_failed";
    if (/FOREIGN KEY constraint failed/i.test(message)) return "check_failed";
    if (/not this class's level/i.test(message)) return "check_failed";
    throw error;
  }
}
