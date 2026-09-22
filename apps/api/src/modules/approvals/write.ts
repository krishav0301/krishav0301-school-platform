import { recordAudit, type AuditEventInput } from "../../core/audit";

export type Failure = { ok: false; reason: "not_allowed" | "not_found" | "conflict" | "stale" } | { ok: false; reason: "invalid"; message: string };
export type Done = { ok: true } | Failure;
export type Created = { ok: true; publicId: string } | Failure;

export const firstMessage = (error: { issues: { message: string }[] }): string => error.issues[0]?.message ?? "That is not valid";

/** What happened to one write. `not_applied`: the conditional SQL matched nothing (not allowed, missing, or a lost race). */
export type Outcome = "done" | "not_applied" | "duplicate" | "check_failed";

/**
 * One change, of one statement or several, and its audit entry, in one batch. The entry is written only if
 * the LAST statement changed a row, so a lost race or a failed re-check leaves no false entry. The
 * database's own refusals are turned into words.
 */
export async function write(db: D1Database, auditKey: string, event: AuditEventInput, statement: D1PreparedStatement | D1PreparedStatement[]): Promise<Outcome> {
  try {
    const { applied } = await recordAudit(db, auditKey, event, Array.isArray(statement) ? statement : [statement], { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    if (/CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(message)) return "check_failed";
    throw error;
  }
}
