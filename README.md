# School Platform

A reusable school management platform and public website, first configured for Royal Softech College, Lahan. Read `CLAUDE.md` for the rules, `docs/DECISIONS.md` for what has been decided, and `docs/build-plan.md` for the phases.

## Layout

```
apps/api    Cloudflare Worker: the API (Hono, D1). It also serves the static web app
apps/web    Next.js static export (public site and portals)
packs/      One folder per school (added in Phase 1)
spikes/     Throwaway test code kept for reference
docs/       Decisions, plan, data model, permission matrix, spikes, original requirement documents
```

One Worker serves both the static pages and `/api/*` on one origin (D-021), so there is no CORS and no cross-site cookie.

## Run it locally

Needs Node 24. No accounts, servers or databases to install: the local database is simulated.

```bash
cd apps/web && npm install && npm run build      # builds the static app into apps/web/out
cd ../api && npm install && npm run dev          # serves app and API at http://localhost:8787
```

Before the first run, create the local database tables and the local secret:

```bash
cd apps/api
cp .dev.vars.example .dev.vars      # then set AUDIT_HMAC_KEY to a long random string
npm run db:migrate:local
```

For fast front-end work with hot reload, run `npm run dev` in `apps/web` as well and open http://localhost:3000. It forwards `/api/*` to the Worker on port 8787.

## Checks

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
cd apps/web && npm run typecheck && npm run lint && npm run build
```

After changing an API route, regenerate the contract and the typed client:

```bash
cd apps/api && npm run gen:openapi
cd apps/web && npm run gen:api
```

CI fails if either generated file is out of date, and it checks that the Worker packages.

## Deploying

Each school is one Worker and one D1 database in a Cloudflare account. Account and database ids stay out of git: put them in a local `apps/api/wrangler.local.jsonc` and deploy with `npx wrangler deploy --config wrangler.local.jsonc`.

## Conventions

- API routes have no trailing slash. `/api/health/` is a 404.
- Every API route is declared through `defineRoute` and states its permission action or `public: true`. A route that does not is caught by a test. Until the permission layer exists, every non-public route is denied.
- One database round trip per request. Atomic changes are one `batch()`.
- Requests that change data must be same-origin.
- The core never names a school. School-specific behaviour lives in `packs/` (see `CLAUDE.md` section 2).
