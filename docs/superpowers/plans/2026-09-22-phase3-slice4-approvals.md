# Phase 3, Slice 4: Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Co-ordinator drafts website content, sends it for approval, and any Admin approves or declines it (with a reason); the engine is generic (one table, five fixed kinds) but only `website_content` is wired.

**Architecture:** a new `approvals` module owning `approval_requests` and a tiny handler interface (`describe`, `currentVersion`, `onRequested`, `onApproved`, `onResolved`), each returning plain data or `D1PreparedStatement[]`. `content` implements the interface and exports it from its `index.ts`; the composition root (`app.ts`) registers it, so `approvals` never imports `content` (the boundary check enforces this). `content`'s create/update routes move from `content.publish` to `content.draft`, giving a Co-ordinator drafting rights the matrix already reserved for them.

**Tech Stack:** Cloudflare Workers, Hono with `@hono/zod-openapi`, D1, Next.js static export.

**Spec:** `docs/superpowers/specs/2026-09-21-phase3-academic-setup-design.md`, section 7 (outline) and the chat design approved 2026-09-22 ("Go ahead"). Decision to log: D-061.

## Global Constraints

- Everything in slices 1–3b's Global Constraints still holds: one audited batch per write with `onlyIfLastChanged`, actor re-checked in SQL, `public_id` only to clients, no hard deletes, words in `messages.ts`, theme tokens only, 44 px controls, modules call each other's `index`/`service` only.
- **Not a workflow engine** (out of scope, section 10): one table, five fixed `kind`s in a CHECK constraint; only `website_content` gets a handler this slice. A later kind registers its own handler with no engine change.
- **One pending request per subject** (a partial unique index); **requester and decider must differ**; **nobody approves their own request**, checked in SQL, not just in the route.
- **A changed subject goes stale**: `approval_requests.subject_version` is compared (in TypeScript, before the decide batch) against the handler's `currentVersion()`. A mismatch marks the request `stale` in its own tiny write and refuses, without touching the subject.
- **Batch-ordering correctness** (worked out below, not obvious, so stated explicitly): `content_items.status` and the request's `status` are always changed together and are each other's guard. `onRequested`'s content statement is conditioned on `status = 'draft'`; the `approval_requests` INSERT that follows it is `INSERT ... SELECT ... WHERE changes() > 0`, so it only inserts if the content statement actually matched (the same `changes()` idiom `recordAudit`'s own trailing insert already uses). Decide (`onApproved`/`onResolved`) runs the content statement FIRST, conditioned on `status = 'waiting'`; the `approval_requests` UPDATE runs LAST, conditioned on `status = 'pending' AND requested_by <> decider AND <decider is an active Admin or Super Admin>`, and is the statement `onlyIfLastChanged` reads — so "did the decision truly apply" and "should the audit entry exist" are answered by the same statement. Content's statement needs no cross-reference to `approval_requests`: the two tables' statuses move in lockstep by construction, so each side's own status is a sufficient guard.
- Branch `phase3-slice4-approvals`.

## Tasks

### Task 1: Migration `0013_approvals.sql`
Files: `apps/api/migrations/0013_approvals.sql`.
```sql
-- Approvals (Phase 3, slice 4, D-061): a generic table, five fixed kinds, only website_content wired.
-- Nothing here is deleted. `subject_id` is the subject's own internal id; it is not a real foreign key
-- because it is polymorphic across kinds (a plain integer, checked only by the handler that owns it).

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('website_content', 'fee_structure', 'discount', 'reversal', 'refund')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'stale', 'withdrawn')),
  requested_by INTEGER NOT NULL REFERENCES users (id),
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  subject_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  decided_by INTEGER REFERENCES users (id),
  decided_at TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK ((status IN ('approved', 'declined')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'declined' OR decision_reason IS NOT NULL)
);

-- One pending request per subject.
CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (subject_type, subject_id) WHERE status = 'pending';
CREATE INDEX approval_requests_requester ON approval_requests (requested_by, status);

-- The fingerprint an approval is checked against at decision time (D-061). Every content write bumps it.
ALTER TABLE content_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```
Test first (`apps/api/test/approvals-schema.test.ts`, copy `teaching-schema.test.ts`'s harness): a second pending request for the same subject fails UNIQUE; a second request after the first is resolved (status set to something else directly) succeeds; `decided_by`/`decided_at` must both be set together with an `approved`/`declined` status (the CHECK); a `declined` row needs a `decision_reason`; an unknown `kind` or `status` is refused (CHECK); `content_items.version` defaults to 1 on an existing row.

- [ ] Write the failing tests above.
- [ ] Run: `cd apps/api && npx vitest run test/approvals-schema.test.ts` — expect FAIL (table/column missing).
- [ ] Add `0013_approvals.sql` as written above.
- [ ] Run again — expect PASS.
- [ ] Commit: `git add apps/api/migrations/0013_approvals.sql apps/api/test/approvals-schema.test.ts && git commit -m "Slice 4: approval_requests and content_items.version"`.

### Task 2: Bump `content_items.version` on every write
Files: `apps/api/src/modules/content/service.ts` (edit `createContent`, `updateContent`; leave `publishContent`/`unpublishContent` — they change `status`, which the handler's own statements already gate on, and are not user-editable content, so they need not bump the fingerprint further, though bumping is harmless; **do bump it in `updateContent` and in the two new content statements added in Task 4**, since an edit is exactly the kind of change staleness must catch).
Change `createContent`'s INSERT to set `version` explicitly to `1` (matches the column default; stating it is clearer than relying on the default alone) and `updateContent`'s UPDATE to add `version = version + 1` alongside the existing `SET` list.
Test first: extend `apps/api/test/content-service.test.ts` (or wherever `updateContent` is already tested — check the file first) with a case that edits an item twice and reads `version` back as 3 (1 at creation, +1 per edit); a no-op edit (`JSON.stringify(after) === JSON.stringify(before)`, which returns early before any write) leaves `version` unchanged.
- [ ] Write the failing test.
- [ ] Run the content service test file — expect FAIL.
- [ ] Make the two `service.ts` edits above.
- [ ] Run again — expect PASS; run the full content suite to confirm nothing else broke.
- [ ] Commit: `git add apps/api/src/modules/content/service.ts apps/api/test/content-service.test.ts && git commit -m "Slice 4: bump content_items.version on every edit"`.

### Task 3: The approvals module's shared types and guard
Files: `apps/api/src/modules/approvals/handler.ts` (new), `apps/api/src/modules/approvals/guard.ts` (new), `apps/api/src/modules/approvals/write.ts` (new, copy `academics/write.ts`'s shape: one statement or several, `onlyIfLastChanged`, message-to-reason mapping).

**Produces**, from `handler.ts`:
```ts
export interface ApprovalHandler {
  /** Null when the subject no longer exists. */
  describe(db: D1Database, subjectId: number): Promise<{ snapshot: unknown; summary: string; subjectPublicId: string } | null>;
  currentVersion(db: D1Database, subjectId: number): Promise<number | null>;
  /** Runs first in the "send for approval" batch, conditioned on the subject's own "may be sent" state. */
  onRequested(subjectId: number): D1PreparedStatement[];
  /** Runs first in the "approve" batch, conditioned on the subject's own "is pending" state. */
  onApproved(subjectId: number): D1PreparedStatement[];
  /** Runs first in the "decline" or "withdraw" batch: reverts the subject to its pre-request state. */
  onResolved(subjectId: number): D1PreparedStatement[];
}
export const HANDLERS = new Map<string, ApprovalHandler>();
export function registerApprovalHandler(kind: string, handler: ApprovalHandler): void {
  HANDLERS.set(kind, handler);
}
```
`guard.ts`:
```ts
/** True for an active Admin or Super Admin. `?n` is their public id. */
export const isDecider = (n: number): string =>
  `EXISTS (SELECT 1 FROM users du JOIN role_assignments dra ON dra.user_id = du.id
            WHERE du.public_id = ?${n} AND du.is_active = 1 AND dra.is_active = 1 AND dra.role IN ('admin', 'super_admin'))`;
```
No new test file for Task 3 alone (both are exercised by Task 4's tests); commit with Task 4.

### Task 4: The approvals service
Files: `apps/api/src/modules/approvals/schema.ts` (new), `apps/api/src/modules/approvals/service.ts` (new).

**Consumes:** `HANDLERS`, `isDecider`, `write` (Task 3); `newPublicId` (`../../core/ids`).
**Produces:** `requestApproval(db, auditKey, actor, { kind, subjectPublicId }): Promise<Created>`, `withdrawRequest(db, auditKey, actor, requestPublicId): Promise<Done>`, `decideRequest(db, auditKey, actor, requestPublicId, decision: { approve: true } | { approve: false; reason: string }): Promise<Done>`.

Add to `schema.ts`:
```ts
export const APPROVAL_KINDS = ["website_content", "fee_structure", "discount", "reversal", "refund"] as const;
export const ApprovalKindSchema = z.enum(APPROVAL_KINDS).openapi("ApprovalKind");
export const RequestInputSchema = z.strictObject({ kind: ApprovalKindSchema, subjectId: z.string().regex(/^[0-9a-f]{32}$/) }).openapi("RequestApproval");
export type RequestInput = z.infer<typeof RequestInputSchema>;
export const DecisionInputSchema = z.discriminatedUnion("approve", [
  z.strictObject({ approve: z.literal(true) }),
  z.strictObject({ approve: z.literal(false), reason: z.string().trim().min(1, "Give a reason").max(500, "Keep the reason to 500 characters") }),
]).openapi("Decision");
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
```
Because `subject_id` is polymorphic (a plain integer per kind, not a public-id-lookupable table by itself), `requestApproval` resolves `subjectPublicId` → the subject's internal id through the handler's own kind-specific lookup. Add one more handler method actually needed for this, folded into Task 3's interface before writing `service.ts` (a one-line addition, not a new task): `resolveId(db: D1Database, subjectPublicId: string): Promise<number | null>`.

```ts
// apps/api/src/modules/approvals/service.ts
import { newPublicId } from "../../core/ids";
import { HANDLERS } from "./handler";
import { isDecider } from "./guard";
import { DecisionInputSchema, RequestInputSchema, type DecisionInput, type RequestInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/** A Co-ordinator sends a draft for approval: the subject moves to its "waiting" state and a pending request is made, in one batch. */
export async function requestApproval(db: D1Database, auditKey: string, actor: string, input: RequestInput): Promise<Created> {
  const parsed = RequestInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const handler = HANDLERS.get(parsed.data.kind);
  if (!handler) return { ok: false, reason: "not_found" };

  const subjectId = await handler.resolveId(db, parsed.data.subjectId);
  if (subjectId === null) return { ok: false, reason: "not_found" };
  const described = await handler.describe(db, subjectId);
  if (!described) return { ok: false, reason: "not_found" };
  const version = await handler.currentVersion(db, subjectId);
  if (version === null) return { ok: false, reason: "not_found" };

  const publicId = newPublicId();
  const insert = db
    .prepare(
      `INSERT INTO approval_requests (public_id, kind, status, requested_by, subject_type, subject_id, subject_version, snapshot, created_at)
       SELECT ?1, ?2, 'pending', u.id, ?2, ?3, ?4, ?5, ?6 FROM users u WHERE u.public_id = ?7 AND changes() > 0`,
    )
    .bind(publicId, parsed.data.kind, subjectId, version, JSON.stringify(described.snapshot), new Date().toISOString(), actor);

  const outcome = await write(
    db,
    auditKey,
    { action: "approvals.request.created", entityType: "approval_request", entityPublicId: publicId, actorPublicId: actor, summary: `Sent for approval: ${described.summary}` },
    [...handler.onRequested(subjectId), insert],
  );
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" }; // already a pending request for this subject
  return { ok: false, reason: "not_found" }; // the content statement's own guard did not match (not a draft)
}
```
(`withdrawRequest` and `decideRequest` follow the same shape: read the request row and its handler first, in one round trip; for `decideRequest`, compare `handler.currentVersion(db, request.subject_id)` to `request.subject_version` — a mismatch runs a **separate, single-statement** conditional `UPDATE approval_requests SET status = 'stale' WHERE id = ?1 AND status = 'pending'` through `write()` and returns `{ ok: false, reason: "stale" }` without touching the subject; otherwise build `[...handler.onApproved(subjectId), decideUpdate]` or `[...handler.onResolved(subjectId), declineUpdate]` per the Global Constraints ordering, where `decideUpdate`/`declineUpdate` is `UPDATE approval_requests SET status = ..., decided_by = (SELECT id FROM users WHERE public_id = ?actor), decided_at = ?now, decision_reason = ?reason WHERE id = ?1 AND status = 'pending' AND requested_by <> (SELECT id FROM users WHERE public_id = ?actor) AND ${isDecider("?actor")} AND changes() > 0`. `withdrawRequest` needs no version check — the requester takes back their own still-pending request — and its guard is `requested_by = (SELECT id FROM users WHERE public_id = ?actor)` instead of `isDecider`.)

Test first (`apps/api/test/approvals-service.test.ts`, seed via `content`'s real `createContent`/`updateContent`, and `person()`/`db`/`auditKey` from a new `approvals-helpers.ts` copying `academics-helpers.ts`'s shape, importing `registerApprovalHandler` and calling it once in a `beforeAll` with a small in-test fake handler AND, separately, with the real `content` handler once Task 5 exists — write this file after Task 5 so it can use the real thing throughout):
- `requestApproval` success: a Co-ordinator sends their own draft; the content item moves to `waiting`; the request is `pending` with the right snapshot and version; a second send while one is pending is `conflict`; sending a non-draft (already `waiting` or `live`) item is `not_found` (the content statement's guard did not match); an Accountant, Student, Teacher may not (their role has no `content.draft`, enforced at the route in Task 6, but the service itself does not re-derive role — confirm this at the route layer, not here, since `requestApproval` trusts its caller the same way `setAssignment` trusts `guarded()` was already checked... **no**: re-read D-021 — every write re-checks the actor in SQL. Since `requestApproval`'s own INSERT does not currently check the actor's role at all beyond "exists", add `AND ${coordinatorForSection...}`-style role check: actually content has no section scope, so add a plain "active Co-ordinator, Admin or Super Admin" fragment to the INSERT's WHERE, mirroring `content/service.ts`'s own `isPublisher`/new `mayDraft`. Import `mayDraft` from `content/service.ts`? That reaches into another module's non-`service` file only if `mayDraft` is not exported from `service.ts` — it will be, since Task 5 adds it there, and `service.ts` is one of the two files a module may import from another module. Add `AND ${mayDraft("?7")}` to the INSERT above once Task 5 exists; note this back into this task before writing the code, not after).
- `decideRequest` success: Approve moves the request to `approved` and the content item to `live`; Decline (with a reason) moves the request to `declined` and the content item back to `draft`; the requester may not decide their own request; a Co-ordinator, Accountant, Student, Teacher may not decide (only Admin/Super Admin); a second decide on an already-resolved request changes nothing and is reported as such; an edited (version-bumped) item is `stale` and the item is untouched; a `stale` request cannot later be approved.
- `withdrawRequest` success: the requester takes back their own pending request (item back to `draft`); the request is `withdrawn`; someone else (even an Admin) may not withdraw another person's request; withdrawing an already-resolved request is a no-op reported as such.
- Audit: one entry per successful call (`approvals.request.created`, `.approved`, `.declined`, `.withdrawn`); a no-op writes none; `verifyAuditChain` passes.

- [ ] Write `approvals-helpers.ts` and the failing tests above (adjust the "Accountant may not request" case to check the route, not the service, once Task 5/6 clarify `mayDraft`'s location — see the parenthetical above).
- [ ] Run: `cd apps/api && npx vitest run test/approvals-service.test.ts` — expect FAIL.
- [ ] Add `handler.ts`, `guard.ts`, `write.ts` (Task 3) and `schema.ts`, `service.ts` (Task 4) together, since Task 4's tests exercise both.
- [ ] Run again — expect PASS.
- [ ] Commit: `git add apps/api/src/modules/approvals apps/api/test/approvals-service.test.ts apps/api/test/approvals-helpers.ts && git commit -m "Slice 4: the approvals engine (request, decide, withdraw)"`.

### Task 5: `content` implements the handler; create/update move to `content.draft`
Files: `apps/api/src/modules/content/service.ts` (add `mayDraft`, the handler object, `resolveId`/`describe`/`currentVersion`/`onRequested`/`onApproved`/`onResolved`), `apps/api/src/modules/content/index.ts` (export the handler), `apps/api/src/modules/content/routes.ts` (`create_content`, `update_content`: `access: { action: "content.draft" }`), `apps/api/src/app.ts` (register the handler).

```ts
// content/service.ts, added
import { registerApprovalHandler, type ApprovalHandler } from "../approvals/handler";

/** True for an active person holding Co-ordinator, Admin or Super Admin (drafting needs no section: content is whole-school). */
export const mayDraft = (n: number) =>
  `EXISTS (SELECT 1 FROM users du JOIN role_assignments dra ON dra.user_id = du.id
            WHERE du.public_id = ?${n} AND du.is_active = 1 AND dra.is_active = 1 AND dra.role IN ('coordinator', 'admin', 'super_admin'))`;

export const contentApprovalHandler: ApprovalHandler = {
  async resolveId(db, publicId) {
    const row = await db.prepare("SELECT id FROM content_items WHERE public_id = ?1").bind(publicId).first<{ id: number }>();
    return row?.id ?? null;
  },
  async describe(db, id) {
    const row = await db.prepare("SELECT public_id, kind, title FROM content_items WHERE id = ?1").bind(id).first<{ public_id: string; kind: string; title: string }>();
    if (!row) return null;
    return { snapshot: row, summary: `${KIND_LABEL[row.kind as ContentKind]} "${row.title}"`, subjectPublicId: row.public_id };
  },
  async currentVersion(db, id) {
    const row = await db.prepare("SELECT version FROM content_items WHERE id = ?1").bind(id).first<{ version: number }>();
    return row?.version ?? null;
  },
  onRequested: (id) => [db /* see note */],
  onApproved: (id) => [/* status -> live */],
  onResolved: (id) => [/* status -> draft */],
};
registerApprovalHandler("website_content", contentApprovalHandler);
```
(`onRequested`/`onApproved`/`onResolved` need a `D1Database` to call `.prepare` on — the interface in Task 3 must take `db` as a parameter, not close over it: revise `ApprovalHandler`'s three `on*` methods to `(db: D1Database, subjectId: number) => D1PreparedStatement[]` before writing Task 3's code. Fix this in Task 3, not here — flagging it now because it surfaced while drafting this task.)
```ts
onRequested: (db, id) => [db.prepare("UPDATE content_items SET status = 'waiting' WHERE id = ?1 AND status = 'draft'").bind(id)],
onApproved: (db, id) => [db.prepare("UPDATE content_items SET status = 'live', published_at = ?2, published_by = NULL WHERE id = ?1 AND status = 'waiting'").bind(id, new Date().toISOString())],
onResolved: (db, id) => [db.prepare("UPDATE content_items SET status = 'draft' WHERE id = ?1 AND status = 'waiting'").bind(id)],
```
(`published_by` stays `NULL` for an approval — the person who made it live is the Admin who approved, but the design does not ask to attribute this the way direct publish does; leave it `NULL` here rather than inventing a second attribution path, and say so in D-061 as a small, deliberate gap.)

In `app.ts`, add `import "./modules/content/service";` is not enough on its own (side-effecting imports for registration are fragile and easy to tree-shake or reorder); instead add an explicit `import { registerContentApprovals } from "./modules/content/service"` style function the composition root calls, OR simplest and most explicit: give `content/index.ts` a `registerApprovals()` export that calls `registerApprovalHandler(...)`, and call it once from `createApp()`:
```ts
// app.ts
import { registerApprovals } from "./modules/approvals/routes";
import { registerContentApprovalHandler } from "./modules/content";
// inside createApp(), before or after registerContent(app):
registerContentApprovalHandler();
registerApprovals(app);
```

Test first: extend `apps/api/test/content-service.test.ts` (or add `content-approvals-handler.test.ts`) — `createContent` by a Co-ordinator now succeeds (previously `not_allowed`); `updateContent` by a Co-ordinator now succeeds; an Accountant, Student, Teacher still cannot create or update; `contentApprovalHandler.describe`/`currentVersion`/`resolveId` return the right values for a real seeded item and `null` for a missing one; `onRequested`'s statement only matches a `draft` item; `onApproved`'s only matches `waiting`; `onResolved`'s only matches `waiting`.

- [ ] Revise Task 3's `ApprovalHandler` interface (the `on*` methods take `db` first) before writing any Task 3/4/5 code — do this now, in one pass, so Tasks 3–5 are internally consistent (this note exists because the inconsistency surfaced only while drafting Task 5; there is no working code yet to contradict).
- [ ] Write the failing tests above.
- [ ] Run: `cd apps/api && npx vitest run test/content-service.test.ts` (plus the new handler test file) — expect FAIL.
- [ ] Make the `content/service.ts`, `content/index.ts`, `content/routes.ts`, `app.ts` changes above.
- [ ] Run again — expect PASS. Run the full `content` and `approvals` suites together (the handler is now real, not the Task 4 fake) to catch any mismatch between the fake used while writing Task 4's tests and the real thing; fix the fake or the test, not the real handler, unless the real handler is wrong.
- [ ] Commit: `git add apps/api/src/modules/content apps/api/src/app.ts apps/api/test/content-*.test.ts && git commit -m "Slice 4: content implements the approval handler; drafting moves to content.draft"`.

### Task 6: Two new permission rows; retire `content.approve`
File: `apps/api/src/core/permissions/matrix.ts`.
```ts
// next to content.approve, which this replaces:
row(G.oversight, "approvals.request", "Send a draft for approval", 3, { COO: inst, ADM: all, SUP: all }),
row(G.oversight, "approvals.view.own", "View your own approval requests", 3, { COO: own }),
```
Delete the `content.approve` row entirely (row 114 in the current file); nothing references it (confirmed: only `content.draft`/`content.publish` are used by routes today).
Test first, in `apps/api/test/permission-matrix.test.ts`: the generated per-row test already covers both new rows once added; add one independent hand-written assertion (in `approvals-routes.test.ts`, Task 7) that a Student, Teacher, Accountant get 403 on every approvals route, and that `content.approve` is gone from `ALL_ACTIONS` (so nothing can silently keep declaring it).
- [ ] Add the two rows, delete `content.approve`.
- [ ] Run: `cd apps/api && npx vitest run test/permission-matrix.test.ts` — expect PASS (the generated test covers new rows automatically; nothing currently asserts `content.approve` exists, so its removal needs no test change, only confirm no route still names it — `grep -rn "content.approve" apps/api/src` returns nothing).
- [ ] Run `npm run gen:permissions` (from `apps/api`) to refresh `docs/permission-matrix.md`.
- [ ] Commit: `git add apps/api/src/core/permissions/matrix.ts docs/permission-matrix.md && git commit -m "Slice 4: approvals.request, approvals.view.own; retire content.approve"`.

### Task 7: The approvals routes and the contract
File: `apps/api/src/modules/approvals/routes.ts` (new).
| Route | Action |
|---|---|
| `POST /api/approvals` `{kind, subjectId}` | `approvals.request` |
| `POST /api/approvals/{id}/withdraw` | `approvals.view.own` (service re-checks `requested_by = actor`) |
| `GET /api/approvals` — pending requests, newest first, with `subjectPublicId`, `summary`, `snapshot`, requester name | `approvals.decide` |
| `GET /api/approvals/mine` — the actor's own requests (any status), with `decisionReason` when declined | `approvals.view.own` |
| `POST /api/approvals/{id}/approve` | `approvals.decide` |
| `POST /api/approvals/{id}/decline` `{reason}` | `approvals.decide` |

Reads need a `queries.ts`: `listPending(db)` and `listMine(db, requesterPublicId)`, each one round trip, joining `users` for the requester's name. Response schemas in `schema.ts`: `ApprovalSummarySchema` (`id`, `kind`, `subjectPublicId`, `summary`, `snapshot` as `z.unknown()`, `requestedBy` name, `createdAt`, and — for `/mine` only — `status`, `decisionReason`).

Test first (`apps/api/test/approvals-routes.test.ts`, copy `academics-routes.test.ts`'s harness): 401 signed out; 403 for Student, Teacher, Accountant on every route; a Co-ordinator may `POST /api/approvals` for their own draft and `GET /mine`, not `GET /` (inbox) or decide; an Admin may `GET /` and decide, not `POST /` (no `approvals.request`... wait, the matrix gives Admin `all` on `approvals.request` too — confirm the test matches the matrix, not an assumption); the full flow end to end through routes only (draft → send → approve, and separately draft → send → decline → the item is a draft again and public site never showed it, since it was never `live`); a stale decide (edit the item via `PATCH /api/content/{id}` between send and decide) is 409 `stale`; withdrawing someone else's request is 403; approving your own request is 403 (`requested_by = decider`). Then `npm run gen:openapi` (from `apps/api`), `npm run gen:api` (from `apps/web`), the full API suite, `node scripts/check-boundaries.mjs` (root).

- [ ] Write the failing route tests.
- [ ] Run: `cd apps/api && npx vitest run test/approvals-routes.test.ts` — expect FAIL.
- [ ] Add `queries.ts`, `schema.ts` additions, `routes.ts`; register in `app.ts` (folded into Task 5's `app.ts` edit if not already done there — check first).
- [ ] Run again — expect PASS.
- [ ] Run `gen:openapi`, `gen:api`, the full API suite, `check-boundaries.mjs` — all green.
- [ ] Commit: `git add apps/api/src/modules/approvals/routes.ts apps/api/src/modules/approvals/queries.ts apps/api/src/modules/approvals/schema.ts apps/api/openapi.json apps/web/src/api/schema.d.ts apps/api/test/approvals-routes.test.ts && git commit -m "Slice 4: the approvals routes and the regenerated contract"`.

### Task 8: The screens
Files: `apps/web/src/content/model.ts` (add `Version`/no — content list already carries `state`; add nothing to the schema-derived type, since the approval flag is engine-side, not content-side, per the design decision in the chat design), `apps/web/src/approvals/` (new folder: `model.ts`, `client.ts`, `RequestsPanel.tsx`, `InboxScreen.tsx`), `apps/web/src/content/ContentList.tsx` (a Co-ordinator's row gets "Send for approval" when `draft`, "Withdraw" when `waiting`, instead of Publish/Take down, which stay Admin/Super-Admin-only; a small "My requests" panel below the list for a Co-ordinator, from `approvals/RequestsPanel.tsx`, showing pending and recently-declined requests with the reason), `apps/web/src/app/portal/approvals/page.tsx` (new, the Admin inbox), `apps/web/src/shell/nav.ts` (a new `approvals` entry, Admin/Super Admin only; add `coordinator` to the existing `content` entry's `roles`), `apps/web/src/i18n/messages.ts`, `apps/web/page-weight-budget.json` (ignore-list the new portal route).

First run the `ui-ux-pro-max` searches (no `--persist`): an inbox/queue pattern with an approve-or-decline pair, a reason required only on decline (progressive disclosure), and a request-status list (mirrors the empty-state and status-badge guidance already applied in `people.teaching`).

`approvals/model.ts`: `export type ApprovalSummary = components["schemas"]["ApprovalSummary"];` plus a `KIND_LABEL` map (only `website_content` has words for now; the other four are unreachable this phase, so their labels are not written yet — a switch with only one case, and a `default: kind` fallback that a future phase replaces, not a silent gap: say so in the code comment).
`approvals/client.ts`: `loadInbox`, `loadMine`, `sendForApproval(api, kind, subjectId)`, `withdraw(api, id)`, `approve(api, id)`, `decline(api, id, reason)` — same `Loaded<T>`/reason-mapping shape as every other client file.
`InboxScreen.tsx`: a list of pending requests, each showing `summary`, the requester, and Approve / Decline buttons; Decline opens an inline reason field (progressive disclosure, mirroring `ComponentForm`'s `<details>` pattern) rather than a separate dialog, since this is a web app with no native sheet.
`RequestsPanel.tsx`: a short list under the Co-ordinator's content list — "Pending" and "Declined, with why" — reusing `setup.module.css`'s list/item classes for visual consistency with every other list in the app.

Message keys: `nav.approvals`, `approvals.inbox.title/intro/empty/approve/decline/declineReason/declineSubmit/done.approved/done.declined`, `approvals.mine.title/empty/pending/declinedWhy`, `content.sendForApproval/sendForApprovalItem/withdraw/withdrawItem/done.sentForApproval/done.withdrawn/error.stale/error.conflict` (a stale send-for-decide only happens to the Admin's inbox, not the Co-ordinator, so `error.stale` lives under `approvals.*`, not `content.*` — correct the prefix here to `approvals.error.stale`).

Test first (`apps/web/test/approvals-screens.test.tsx`, copy `teaching-screens.test.tsx`'s harness): the inbox lists pending requests with Approve/Decline; Decline requires a non-empty reason before it may submit; the panel shows a Co-ordinator's own pending and declined requests with the reason; the content list shows "Send for approval" for a Co-ordinator's draft and "Withdraw" for their waiting item, and still shows Publish/Take down for the Admin unchanged; the loading shape; the nav entry appears only for Admin/Super Admin (inbox) and the content entry now also appears for a Co-ordinator. Update `apps/web/test/nav.test.ts` (or wherever nav is tested — check first) for the widened `content` entry and the new `approvals` entry.

- [ ] Write the failing tests above.
- [ ] Run: `cd apps/web && npx vitest run test/approvals-screens.test.tsx` — expect FAIL.
- [ ] Add the message keys, `approvals/` folder, `ContentList.tsx` changes, `nav.ts` changes, the new page.
- [ ] Run again — expect PASS.
- [ ] Run `cd apps/web && npx vitest run` (full suite: `guards.test.ts`, nav test, page-weight) and fix the budget ignore-list if needed.
- [ ] Commit: `git add apps/web/src/approvals apps/web/src/content/ContentList.tsx apps/web/src/app/portal/approvals apps/web/src/shell/nav.ts apps/web/src/i18n/messages.ts apps/web/test/approvals-screens.test.tsx apps/web/page-weight-budget.json && git commit -m "Slice 4: the Approvals inbox, the Co-ordinator's requests panel, and the widened Content nav entry"`.

### Task 9: See it work and review the design
- Local database: apply migration `0013` locally (`db:migrate:local`), then `npm run provision -- --pack ../../packs/royal-softech --local`.
- Start `web-dev` and (if not already running) `worker`; sign in as the PM's local Admin (read-only look at the inbox once something is pending) at `http://localhost:3000` — seed a pending request through the real services with a short throwaway script (delete it afterward), the same way slice 3b did, since I do not type passwords and cannot drive the Co-ordinator side myself.
- Check at 320 px wide with text at 200%: the inbox's Approve/Decline pair and the reason field; no sideways scroll; every control at least 44 px; dark and light both read cleanly; no console errors.
- `apple-design` review: read `accessibility.md`, `layout.md`, `writing.md`, `feedback.md` (a decision is exactly the kind of "confirm a significant action completed" case that page covers), `modality.md` (the inline decline-reason disclosure is a lightweight modal-adjacent pattern; confirm it has an obvious way out, matching `sheets.md`'s spirit even though this is web, not a native sheet).
- Fix what the review finds; note what is left and why.

### Task 10: Prove it, log it, ship it
Mutation checks (each must fail a named test):
1. Remove the `approval_requests_one_pending` unique index — two pending requests for the same subject must then succeed, caught by Task 1's test.
2. Remove the CHECK tying `decided_by`/`decided_at` to `approved`/`declined` — an approval with no decider must then succeed, caught by Task 1's test.
3. Drop `AND changes() > 0` from the `approval_requests` INSERT in `requestApproval` — sending a non-draft item for approval must then still create a pending request even though the content statement did not match, caught by Task 4's "sending a non-draft item is not_found" test.
4. Reorder `decideRequest`'s statements so the `approval_requests` UPDATE runs before `onApproved`'s content statement — a lost race (two approvals of the same request) must then be able to publish the content item twice (or leave it live with no matching approved request), caught by Task 4's "a second decide on an already-resolved request changes nothing" test.
5. Remove the `requested_by <> decider` condition — approving your own request must then succeed, caught by Task 4's and Task 7's "approving your own request is 403" tests.
6. Remove the `isDecider` condition from the decide UPDATE — a Co-ordinator or Accountant must then be able to decide, caught by Task 7's role tests.
7. Skip the version check in `decideRequest` — deciding a request whose subject changed since must then succeed instead of going `stale`, caught by Task 4's staleness test.
8. Change `mayDraft` to admin/super-admin only (its old shape) — a Co-ordinator creating or updating content must then fail again, caught by Task 5's test.
9. Remove `version = version + 1` from `updateContent` — an edited item's version must then stay unchanged, caught by Task 2's test.

Then:
- [ ] Log D-061 in `docs/DECISIONS.md` (built to, files touched, rules chosen while building — retiring `content.approve`, `published_by` left `NULL` on an approved publish, the batch-ordering approach — tested, found-and-fixed, design review, not verified by me, not done).
- [ ] Update `docs/data-model.md` (`ApprovalRequest`'s real columns, `ContentItem`'s new `version`) and the status lines in `CLAUDE.md`, `docs/build-plan.md`, and project memory.
- [ ] Push the branch; replay CI in a fresh clone (all three jobs: api, web, bundle).
- [ ] Open the PR; wait for 6 of 6 on the latest commit.
- [ ] **Ask the PM before merging.**

## Self-review notes

- Spec coverage: the table and the generic handler interface (§7) → Tasks 1, 3, 4; the version fingerprint and staleness (§7) → Tasks 1, 2, 4; the composition root wiring so `approvals` never imports `content` (§7) → Task 5; approve-and-apply as one conditional batch, a second click answering "already resolved" (§7) → Task 4; the Co-ordinator flow and the Admin inbox screen (§7) → Task 8; the two new matrix rows (§7) → Task 6.
- Two things were caught only while drafting later tasks and folded back into earlier ones rather than left inconsistent: the `ApprovalHandler`'s `on*` methods needed `db` as a parameter (surfaced in Task 5, fixed in Task 3 before any code is written); `mayDraft`'s exact location (`content/service.ts`, so `approvals` can import it via the allowed `service` path) needed deciding before Task 4's "who may request" test could be written precisely.
- Type check: `ApprovalHandler` (Task 3) is the same shape `content`'s handler object (Task 5) implements and `approvals/service.ts` (Task 4) consumes; `RequestInput`/`DecisionInput` (Task 4) match what `routes.ts` (Task 7) parses; `ApprovalSummary` (Task 7) is what `approvals/model.ts` (Task 8) re-exports.
