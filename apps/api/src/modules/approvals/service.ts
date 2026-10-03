import { newPublicId } from "../../core/ids";
import { getApprovalHandler, registerApprovalHandler, type ApprovalHandler } from "./handler";
import { isDecider, mayRequest } from "./guard";
import { DecisionInputSchema, RequestInputSchema, type DecisionInput, type RequestInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/** What other kinds' modules use to plug into the engine (the layer check allows only an `index` or a `service`). */
export { registerApprovalHandler, type ApprovalHandler };
export type { ApprovalDetail } from "./schema";

/**
 * The approvals engine (D-061): a Co-ordinator sends a draft for approval, any Admin approves or
 * declines it (with a reason), or the requester takes it back. Generic across kinds: each kind
 * registers an `ApprovalHandler` (see `handler.ts`), and this file never names one.
 */

interface RequestRow {
  id: number;
  public_id: string;
  kind: string;
  status: string;
  subject_id: number;
  requested_by: string; // the requester's own public id, for the "not your own" checks
}

async function lookRequest(db: D1Database, requestPublicId: string): Promise<RequestRow | null> {
  const row = await db
    .prepare(
      `SELECT ar.id, ar.public_id, ar.kind, ar.status, ar.subject_id, ru.public_id AS requested_by
         FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by
        WHERE ar.public_id = ?1`,
    )
    .bind(requestPublicId)
    .first<RequestRow>();
  return row ?? null;
}

/** A Co-ordinator sends a draft for approval: the subject moves to its "waiting" state and a pending request is made, in one batch. */
export async function requestApproval(db: D1Database, auditKey: string, actor: string, input: RequestInput): Promise<Created> {
  const parsed = RequestInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { kind, subjectId: subjectPublicId } = parsed.data;

  const handler = getApprovalHandler(kind);
  if (!handler) return { ok: false, reason: "not_found" };

  // Checked BEFORE any statement runs, not only inside the INSERT's own WHERE: `onRequested`'s statement
  // is content-specific and has no notion of who may ask, so it must never run for a disallowed actor.
  // (The re-check still sits inside the INSERT's WHERE too, as defense in depth against a role that
  // changes in the moment between this read and the write — the same two-phase shape `content/service.ts`
  // already uses for `isPublisher`.)
  const requester = handler.requesterSql ?? mayRequest;
  const allowed = await db.prepare(`SELECT ${requester(1)} AS ok`).bind(actor).first<{ ok: number }>();
  if (allowed?.ok !== 1) return { ok: false, reason: "not_allowed" };

  const subjectId = await handler.resolveId(db, subjectPublicId);
  if (subjectId === null) return { ok: false, reason: "not_found" };
  const described = await handler.describe(db, subjectId);
  if (!described) return { ok: false, reason: "not_found" };
  const version = await handler.currentVersion(db, subjectId);
  if (version === null) return { ok: false, reason: "not_found" };

  const publicId = newPublicId();
  const insert = db
    .prepare(
      `INSERT INTO approval_requests (public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, created_at)
       SELECT ?1, ?2, 'pending', u.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         FROM users u WHERE u.public_id = ?9 AND ${requester(9)} AND changes() > 0`,
    )
    .bind(publicId, kind, subjectId, described.subjectPublicId, described.summary, version, JSON.stringify(described.snapshot), new Date().toISOString(), actor);

  const outcome = await write(
    db,
    auditKey,
    { action: "approvals.request.created", entityType: "approval_request", entityPublicId: publicId, actorPublicId: actor, summary: `Sent for approval: ${described.summary}` },
    [...handler.onRequested(db, subjectId), insert],
  );
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" }; // already a pending request for this subject
  return { ok: false, reason: "not_found" }; // already known allowed, so the subject itself was not a draft (or vanished)
}

/** The requester takes back their own still-pending request; the subject reverts to its pre-request state. */
export async function withdrawRequest(db: D1Database, auditKey: string, actor: string, requestPublicId: string): Promise<Done> {
  const request = await lookRequest(db, requestPublicId);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.requested_by !== actor) return { ok: false, reason: "not_allowed" };
  if (request.status !== "pending") return { ok: true }; // already resolved: nothing to take back, nothing to record

  const handler = getApprovalHandler(request.kind);
  if (!handler) return { ok: false, reason: "not_found" };

  await write(
    db,
    auditKey,
    { action: "approvals.request.withdrawn", entityType: "approval_request", entityPublicId: requestPublicId, actorPublicId: actor, summary: "Approval request withdrawn" },
    [
      ...handler.onResolved(db, request.subject_id),
      db
        .prepare(`UPDATE approval_requests SET status = 'withdrawn' WHERE id = ?1 AND status = 'pending' AND requested_by = (SELECT id FROM users WHERE public_id = ?2) AND changes() > 0`)
        .bind(request.id, actor),
    ],
  );
  return { ok: true }; // a lost race (already resolved a moment ago) is not an error: the person's request is not pending either way
}

/** Any Admin or Super Admin approves or declines a pending request, never their own. A changed subject goes stale. */
export async function decideRequest(db: D1Database, auditKey: string, actor: string, requestPublicId: string, decision: DecisionInput): Promise<Done> {
  const parsed = DecisionInputSchema.safeParse(decision);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  const request = await lookRequest(db, requestPublicId);
  if (!request) return { ok: false, reason: "not_found" };
  // Already resolved: a stale one says so, anything else was decided (or taken back) by someone else (admin FUT F-07).
  if (request.status === "stale") return { ok: false, reason: "stale" };
  if (request.status !== "pending") return { ok: false, reason: "already_decided" };
  if (request.requested_by === actor) return { ok: false, reason: "own_request" }; // never your own (admin FUT F-13)

  // Checked BEFORE any statement runs, for the same reason as `requestApproval`: the handler's own
  // `onApproved`/`onResolved` statement has no notion of who may decide, so a disallowed actor must
  // never reach it. Re-checked again inside the decide UPDATE's own WHERE, as defense in depth.
  const deciderCheck = await db.prepare(`SELECT ${isDecider(1)} AS ok`).bind(actor).first<{ ok: number }>();
  if (deciderCheck?.ok !== 1) return { ok: false, reason: "not_allowed" };

  const handler = getApprovalHandler(request.kind);
  if (!handler) return { ok: false, reason: "not_found" };

  const currentVersion = await handler.currentVersion(db, request.subject_id);
  if (currentVersion === null) return { ok: false, reason: "not_found" };
  const staleRow = await db.prepare("SELECT subject_version FROM approval_requests WHERE id = ?1").bind(request.id).first<{ subject_version: number }>();
  if (staleRow && staleRow.subject_version !== currentVersion) {
    await write(
      db,
      auditKey,
      { action: "approvals.request.staled", entityType: "approval_request", entityPublicId: requestPublicId, actorPublicId: actor, summary: "Approval request went stale: the subject changed" },
      db.prepare(`UPDATE approval_requests SET status = 'stale' WHERE id = ?1 AND status = 'pending'`).bind(request.id),
    );
    return { ok: false, reason: "stale" };
  }

  const now = new Date().toISOString();
  const decideStatement = parsed.data.approve
    ? db
        .prepare(
          `UPDATE approval_requests SET status = 'approved', decided_by = (SELECT id FROM users WHERE public_id = ?2), decided_at = ?3
            WHERE id = ?1 AND status = 'pending' AND requested_by <> (SELECT id FROM users WHERE public_id = ?2) AND ${isDecider(2)} AND changes() > 0`,
        )
        .bind(request.id, actor, now)
    : db
        .prepare(
          `UPDATE approval_requests SET status = 'declined', decided_by = (SELECT id FROM users WHERE public_id = ?2), decided_at = ?3, decision_reason = ?4
            WHERE id = ?1 AND status = 'pending' AND requested_by <> (SELECT id FROM users WHERE public_id = ?2) AND ${isDecider(2)} AND changes() > 0`,
        )
        .bind(request.id, actor, now, parsed.data.reason);

  const event = {
    action: parsed.data.approve ? "approvals.request.approved" : "approvals.request.declined",
    entityType: "approval_request",
    entityPublicId: requestPublicId,
    actorPublicId: actor,
    summary: parsed.data.approve ? "Approval request approved" : "Approval request declined",
    ...(parsed.data.approve ? {} : { reason: parsed.data.reason }),
  };

  // A kind whose approval writes ledger entries (fees) builds them from the ledger's head at this moment; if another
  // write moved the head before this batch lands, the whole batch rolled back, and it is rebuilt and tried again.
  let outcome: Awaited<ReturnType<typeof write>> | null = null;
  for (let attempt = 1; attempt <= 30; attempt++) {
    const ledgerHead = (await db.prepare("SELECT last_hash FROM ledger_chain_head WHERE id = 1").first<{ last_hash: string }>())?.last_hash ?? "0".repeat(64);
    const handlerStatements = parsed.data.approve
      ? await handler.onApproved(db, request.subject_id, { auditKey, actorPublicId: actor, ledgerHead })
      : handler.onResolved(db, request.subject_id);
    try {
      outcome = await write(db, auditKey, event, [...handlerStatements, decideStatement]);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A money kind still waiting when its year closed: the ledger refuses it, and nothing was applied (D-085).
      if (/academic year is closed/i.test(message)) return { ok: false, reason: "invalid", message: "The academic year is closed, so this can no longer be applied" };
      if (!/ledger chain moved|UNIQUE constraint failed: ledger_entries\.(prev_hash|hash)/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * Math.min(attempt, 5)));
    }
  }
  // A busy ledger is never reported as "someone else decided it" (D-085).
  if (outcome === null) throw new Error("The ledger is too busy: could not apply the approval after several attempts.");
  return outcome === "done" ? { ok: true } : { ok: false, reason: "already_decided" }; // a lost race: someone else decided it a moment ago
}
export { approvalsDashboardPart } from "./queries";
