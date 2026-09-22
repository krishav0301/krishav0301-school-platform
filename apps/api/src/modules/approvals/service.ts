import { newPublicId } from "../../core/ids";
import { getApprovalHandler, registerApprovalHandler, type ApprovalHandler } from "./handler";
import { isDecider, mayRequest } from "./guard";
import { DecisionInputSchema, RequestInputSchema, type DecisionInput, type RequestInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/** What other kinds' modules use to plug into the engine (the layer check allows only an `index` or a `service`). */
export { registerApprovalHandler, type ApprovalHandler };

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
  const allowed = await db.prepare(`SELECT ${mayRequest(1)} AS ok`).bind(actor).first<{ ok: number }>();
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
         FROM users u WHERE u.public_id = ?9 AND ${mayRequest(9)} AND changes() > 0`,
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
  if (request.status !== "pending") return { ok: false, reason: "conflict" }; // already resolved
  if (request.requested_by === actor) return { ok: false, reason: "not_allowed" }; // never your own

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

  const handlerStatements = parsed.data.approve ? handler.onApproved(db, request.subject_id) : handler.onResolved(db, request.subject_id);

  const outcome = await write(
    db,
    auditKey,
    {
      action: parsed.data.approve ? "approvals.request.approved" : "approvals.request.declined",
      entityType: "approval_request",
      entityPublicId: requestPublicId,
      actorPublicId: actor,
      summary: parsed.data.approve ? "Approval request approved" : "Approval request declined",
      ...(parsed.data.approve ? {} : { reason: parsed.data.reason }),
    },
    [...handlerStatements, decideStatement],
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "conflict" }; // a lost race: someone else decided it a moment ago
}
