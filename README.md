# School Platform

A reusable school management platform and public website, first configured for Royal Softech College, Lahan. Read `CLAUDE.md` for the rules, `docs/DECISIONS.md` for what has been decided, and `docs/build-plan.md` for the phases.

## Layout

```
apps/api    Django API (modular monolith, PostgreSQL)
apps/web    Next.js web app (public site and portals)
packs/      One folder per school (added in Phase 1)
docs/       Decisions, plan, spikes, original requirement documents
```

## Run it locally

Needs Python 3.12 (through `uv`), Node 24, and PostgreSQL 17.

```bash
cd apps/api
cp .env.example .env        # then set SECRET_KEY and DATABASE_URL
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 127.0.0.1:8000
```

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. The page shows the API and database status.

## Checks

```bash
cd apps/api && uv run ruff check . && uv run ruff format --check . && uv run lint-imports && uv run pytest
cd apps/web && npm run typecheck && npm run lint && npm run build
```

After changing an API endpoint, regenerate the contract and the typed client:

```bash
cd apps/api && uv run python manage.py spectacular --file openapi.yml --validate
cd apps/web && npm run gen:api
```

CI fails if either generated file is out of date.

## Conventions

- Every API route ends in a slash. A missing slash is a 404, not a redirect.
- Every API view declares its permissions. A view that does not is denied, and a test fails.
- The core never names a school. School-specific behaviour lives in `packs/` (see `CLAUDE.md` section 2).
