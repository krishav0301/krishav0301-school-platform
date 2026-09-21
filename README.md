# School Platform

A reusable school management platform and public website, first configured for Royal Softech College, Lahan. Read `CLAUDE.md` for the rules, `docs/DECISIONS.md` for what has been decided, and `docs/build-plan.md` for the phases.

## Layout

```
apps/api    Cloudflare Worker: the API (Hono, D1). It also serves the static web app
apps/web    Next.js static export (public site and portals)
packs/      One folder per school (`pack.json`: sections, modules, wording, theme)
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

Before the first run, set up the local secrets, then create the school's database from its pack and a sign-in for yourself:

```bash
cd apps/api
cp .dev.vars.example .dev.vars      # then set AUDIT_HMAC_KEY, SESSION_SECRET and DATA_KEY to three different long random strings, and SITE_ORIGIN to http://localhost:3000
npm run provision -- --pack ../../packs/royal-softech --local     # migrations + the school's pack
USER_PASSWORD='a long passphrase' npm run dev:user -- --email you@school.example --name "Your Name" --role coordinator
```

To look at the public notice board with something on it, add clearly labelled sample content for an Admin you created (local database only): `npm run dev:content -- --email you@school.example`, then open `/notices`.

Applying a different pack (`packs/sample-basic-school`) to the same local database swaps the school's name, wording, modules and theme, which is a quick way to see that one build serves any school. `/design` shows every component in the current theme.

For fast front-end work with hot reload, run `npm run dev` in `apps/web` as well and open http://localhost:3000. It forwards `/api/*` to the Worker on port 8787.

## Checks

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
cd apps/web && npm run typecheck && npm run lint && npm test && npm run build
node scripts/check-boundaries.mjs        # from the repo root
```

After changing an API route, regenerate the contract and the typed client:

```bash
cd apps/api && npm run gen:openapi
cd apps/web && npm run gen:api
```

CI fails if either generated file is out of date, and it checks that the Worker packages.

## Deploying

Each school is one Worker and one D1 database in a Cloudflare account. The public pages the Worker fills in for crawlers (`FILLED_PAGES` in `apps/api/src/modules/site/pages.ts`) must also be listed in `run_worker_first`, in `wrangler.jsonc` and in your `wrangler.local.jsonc`; CI checks the first, not yours (D-046). Account and database ids stay out of git: put them in a local `apps/api/wrangler.local.jsonc` (with the vars `ENVIRONMENT`, `EMAIL_ADAPTER` and `SITE_ORIGIN`, and the `triggers.crons` sweep) and deploy with `npx wrangler deploy --config wrangler.local.jsonc`.

The steps for a new deployment, in order:

```bash
cd apps/api
# 1. Secrets (three different long random values; keep them with the operator, never in git):
npx wrangler secret put AUDIT_HMAC_KEY --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler secret put DATA_KEY --config wrangler.local.jsonc
# 2. The database: migrations and the school's pack:
npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.local.jsonc
# 3. Build the web app (apps/web: npm run build) and deploy:
npx wrangler deploy --config wrangler.local.jsonc
# 4. The first Super Admin, through the same service the screens use (audit entry included).
#    Needs the deployment's audit key in the environment. The Super Admin sets up an authenticator app at first sign-in.
USER_PASSWORD='...' AUDIT_HMAC_KEY='...' npm run dev:user -- --remote --config wrangler.local.jsonc --email you@school.example --name "Support" --role super_admin
```

Stop `wrangler dev` before `npm run build` in `apps/web` on Windows: it holds the `out` folder open.

## Conventions

- API routes have no trailing slash. `/api/health/` is a 404.
- Every API route is declared through `defineRoute` and states its permission action or `public: true`. A route that does not is caught by a test. The permission matrix decides who may call it (`docs/permission-matrix.md`).
- One database round trip per request. Atomic changes are one `batch()`.
- Requests that change data must be same-origin.
- The core never names a school. School-specific behaviour lives in `packs/` (see `CLAUDE.md` section 2).
