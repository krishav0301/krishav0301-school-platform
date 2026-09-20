# Architecture

Status: written 2026-09-20 after D-019 to D-021. This describes how the pieces fit. The rules themselves are in `CLAUDE.md`; the reasons are in `DECISIONS.md` and `spikes/`.

## The shape

```
Browser
   |  one origin, one Worker per school
   v
Cloudflare Worker  ─────────────  static web app (Workers Static Assets)   /, /admissions, ...
   |                              API (Hono)                               /api/*
   |
   ├── D1 (SQLite)      the school's data, one database per school
   ├── Queues + Cron    background work: notifications, reminders, outbox
   ├── Browser Rendering   receipts and marks cards (PDF), batched
   └── R2               files (not enabled yet, D-020)
```

Requests outside `/api/*` are served straight from static assets and never wake the Worker, so public pages cost nothing against the Worker request limit.

## One API request

1. `environmentGuard`: refuses to serve if the configuration is unsafe (for example demo mode in production).
2. `sameOriginOnly`: a write must come from our own origin (`Sec-Fetch-Site: same-origin`, or an `Origin` equal to ours). There is no CORS.
3. Authentication (Phase 1): verify the signed access cookie; if it expired, rotate the refresh session (one database round trip).
4. Permission check (Phase 1): the route's declared action against the user's role assignments. Deny by default. Routes are declared only through `defineRoute`.
5. The handler calls a **service** (writes) or a **query** (reads). It builds **one** database round trip: joins for reads, `batch()` for changes.
6. Every change writes an audit row and, if it must notify anyone, an outbox row, in the same batch.
7. Response validated against the route's Zod schema.

## Modules

`apps/api/src/modules/<name>/` holds `routes.ts` (HTTP, validation), `service.ts` (all writes), `queries.ts` (all reads), `schema.ts` (Zod types), and tests. `core/` holds what every module shares: types, environment guard, same-origin rule, route declaration, permissions, crypto, dates, jobs.

Rules: a module calls another module's **service**, never its tables. A test enforces the boundaries. Nothing in `core/` or `modules/` names a school.

## Data

- One D1 database per school. Migrations are hand-written SQL in `apps/api/migrations/`, applied with `wrangler d1 migrations apply`. Migrations must be backward compatible.
- No ORM. SQL is explicit so each request's round trips are visible. Each round trip costs about 100 ms from Nepal.
- Atomic changes are one `batch()`. Approve-and-apply, payment with receipt number, and SID assignment each use conditional SQL so a race has exactly one winner (proven in `spikes/cloudflare-test.md`).
- Ledger and audit rows are protected by triggers and a hash chain (D1 has no database accounts). A daily export of the chain goes to a second location.
- See `data-model.md` for tables and `permission-matrix.md` for who may do what.

## Sessions

- `__Host-access`: a signed token, 30 minutes (each renewal is a database write; the free plan allows 100,000 a day), carrying the user's roles and scopes. `__Host-refresh`: an opaque token; only its hash is stored in the `session` table; rotated on every use.
- A deactivated user or a changed role takes effect at the next refresh. **Money, approval and publish actions re-check the user's assignments inside their own batch**, so they never rely on a stale token.
- Passwords: scrypt (N=2^15, r=8, p=1). Lockout and rate limits on sign-in and OTP. The client retries a 503.

## Background work

The outbox row is written in the same batch as the change. A Cron Trigger and a Queue consumer drain it, and handlers are idempotent (unique key per event, recipient and channel), so a retry never sends twice. SMS and email sit behind adapters; demo adapters write to the log or the in-app inbox.

## Documents

Receipts and marks cards are HTML rendered by Browser Rendering. A class's marks cards are generated in **one browser session**, because the free plan rate-limits browser starts. A self-hosted Noto Sans Devanagari is embedded. The database is the record; the PDF is a rendering.

## Per school

A school is one Worker and one D1 database in a Cloudflare account, plus a **pack**: `packs/<school>/` with its deployment config, theme, and configuration data (and, only if needed, extensions). The core is identical for every school. Deploy with `npx wrangler deploy --config <pack config>`. Ids for accounts and databases stay out of git. A pack is data only: `pack.json` holds the school, sections, optional-module switches, renamed words and theme; `npm run provision` applies it (D-026). The web app reads it at run time from `GET /api/config/public` and never has a school baked in.

Extension points (D-008) are interfaces in `core/` with a default implementation and a contract test: policies (grading, ranking, student-ID format, fee schedule, promotion, admission rules), adapters (SMS, email, payment, storage), documents, custom fields, slots, events. The second-school fixture `packs/sample-basic-school` runs the same flows in CI.

## Testing

Vitest running inside the Workers runtime (real D1 behaviour, simulated locally). Tests before code for the ledger, approvals, grading, year locks and permissions. The permission matrix generates a test per role and action. Property-based tests cover ledger invariants. CI also checks that the API contract and generated client are current, that no file has a byte-order mark, and that the Worker packages.

## Watch list

- **Free-tier limits:** Workers 100,000 requests a day; D1 100,000 rows written and 5,000,000 read a day, and queries fail past the limit. Index queries and avoid scans.
- **Sign-in writes.** A failed sign-in is one database write, and the free plan allows 100,000 a day. Lockout caps a single email at 5 and a single address at 30 per 15 minutes, and throttled attempts write nothing, but a spread-out attack could still add up. Add a Cloudflare rate-limiting rule on `/api/auth/sign-in` (Phase 9 or earlier) and a Turnstile check if abuse appears.
- **Cron reliability** on the free plan (one report of triggers stopping). Add an in-app "last ran" indicator and alert.
- **Provider rule changes.** Cloudflare has tightened free limits this year. The tripwire in `spikes/hosting-options.md` still applies.
- **Latency:** every extra database round trip adds about 100 ms. Reviewers should count them.
