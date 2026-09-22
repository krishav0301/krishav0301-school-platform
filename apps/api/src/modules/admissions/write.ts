import { recordAudit, type AuditEventInput } from "../../core/audit";

/** What happened to one write. `not_applied`: the conditional SQL matched nothing (not allowed, missing, or a lost race). */
export type Outcome = "done" | "not_applied" | "duplicate" | "check_failed";

/**
 * One change, possibly of several statements, and its audit entry, in one batch. The entry is written only if the LAST
 * statement changed a row, so a failed re-check or a lost race leaves no false entry and nothing half-made.
 */
export async function write(db: D1Database, auditKey: string, event: AuditEventInput, statements: D1PreparedStatement[]): Promise<Outcome> {
  try {
    const { applied } = await recordAudit(db, auditKey, event, statements, { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    if (/CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(message)) return "check_failed";
    throw error;
  }
}
