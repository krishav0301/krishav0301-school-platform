/**
 * The generic approvals engine (D-061) never imports a specific kind's module (`content`, and later
 * `fees`): each kind registers a handler here, from the composition root (`app.ts`), that speaks only
 * in plain data and prepared statements. This keeps the layer boundary check honest (a module may
 * import another module's `service` or `index`, never its internals) while letting `approvals` drive
 * any kind's subject through the same request/decide/withdraw flow.
 */

export interface ApprovalHandler {
  /** Looks up the subject's own internal id from its public id. Null when there is no such subject. */
  resolveId(db: D1Database, subjectPublicId: string): Promise<number | null>;
  /** A snapshot of the subject as it stands now, for the inbox to show, and a one-line summary. Null when gone. */
  describe(db: D1Database, subjectId: number): Promise<{ snapshot: unknown; summary: string; subjectPublicId: string } | null>;
  /** The subject's own version fingerprint right now. Null when gone. */
  currentVersion(db: D1Database, subjectId: number): Promise<number | null>;
  /** Runs FIRST in the "send for approval" batch, conditioned on the subject's own "may be sent" state. */
  onRequested(db: D1Database, subjectId: number): D1PreparedStatement[];
  /** Runs FIRST in the "approve" batch, conditioned on the subject's own "is pending" state. */
  onApproved(db: D1Database, subjectId: number): D1PreparedStatement[];
  /** Runs FIRST in the "decline" or "withdraw" batch: reverts the subject to its pre-request state. */
  onResolved(db: D1Database, subjectId: number): D1PreparedStatement[];
}

const HANDLERS = new Map<string, ApprovalHandler>();

export function registerApprovalHandler(kind: string, handler: ApprovalHandler): void {
  HANDLERS.set(kind, handler);
}

export function getApprovalHandler(kind: string): ApprovalHandler | undefined {
  return HANDLERS.get(kind);
}
