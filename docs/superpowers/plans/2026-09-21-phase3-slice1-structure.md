# Phase 3, Slice 1: Academic Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Co-ordinator can set up academic years, programmes with levels, classes and terminals (API, pack seed and screens), with every write audited, permission-checked inside its batch, and refused in a closed year.

**Architecture:** A new `academics` module (`routes`, `service`, `queries`, `schema`, `guard`) over five new tables (migration `0009`). Every write is one `recordAudit` batch whose SQL re-checks the person's active role and scope. Programmes and levels are also seeded from a new optional `academics` block in the pack, insert-if-missing only. The web app gets a Setup area with four small screens built from the existing UI kit and theme tokens.

**Tech Stack:** Cloudflare Workers, Hono with `@hono/zod-openapi`, D1 (SQLite), vitest with `@cloudflare/vitest-pool-workers`, Next.js static export, `openapi-fetch`.

**Spec:** `docs/superpowers/specs/2026-09-21-phase3-academic-setup-design.md` (sections 3 and 4 are this slice). Decision log: D-056.

## Global Constraints

- **One `batch()` per write**, through `recordAudit(..., { onlyIfLastChanged: true })`, so the audit entry exists only if the change happened. The person's role is **re-checked inside the write's own SQL**, never trusted from the token (D-021).
- **No hard deletes.** Rows are deactivated (`is_active = 0`), never removed.
- **Ids sent to clients are `public_id`** (32 hex characters), never the integer id.
- **Dates are stored AD (`YYYY-MM-DD`)** and shown BS through `apps/api/src/core/dates` only. Only verified BS years (2000 to 2083) are accepted; `isVerifiedBsYear`, `adToBs`, `bsToAd` and `daysInMonth` are the only conversion entry points.
- **A closed year rejects every write**, in the service SQL **and** in `BEFORE INSERT/UPDATE/DELETE` triggers.
- **Scope:** a section-scoped Co-ordinator manages only the programmes, levels and classes of their own section. Years and terminals are institution-level: only an institution-scoped Co-ordinator or the Super Admin manages them; a section-scoped Co-ordinator can only view. The Admin can view, never change.
- **Modules call each other's `index` or `service` only** (`scripts/check-boundaries.mjs`). `academics` must not import from `content`.
- **Web:** every word in `apps/web/src/i18n/messages.ts`; theme tokens only (no colour, font or motion written out); controls at least 44 px; one prominent button per view; each screen checked at 320 px wide with text at 200%; new components pass `apps/web/test/guards.test.ts` and get a markup test.
- **Tests before code.** After each task, break the code on purpose to confirm a test fails (mutation checks are listed in Task 10).
- **Migrations are hand-written SQL**, numbered `0009_academic_structure.sql`, backward compatible.
- **Every commit message ends with** `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (pass it as a second `-m`).
- **Windows notes:** working-tree files are CRLF (git stores LF), so anchor `Edit` calls on single lines; use absolute paths; run `npx vitest` and `npx tsc` from `apps/api` or `apps/web`; do not run `wrangler types` (use `npx tsc --noEmit`); do not start or stop someone else's `wrangler dev`.
- Branch: `phase3-slice1-structure` (already created; the design commit is on it).

## File Structure

**Create (API)**
- `apps/api/migrations/0009_academic_structure.sql`: five tables, one-active-year index, closed-year triggers.
- `apps/api/src/modules/academics/guard.ts`: the two SQL fragments that re-check a person inside a write.
- `apps/api/src/modules/academics/write.ts`: result types, `write()` (audit batch plus error translation).
- `apps/api/src/modules/academics/schema.ts`: Zod schemas for requests and responses.
- `apps/api/src/modules/academics/years.ts`, `programmes.ts`, `classes.ts` (classes and terminals): the writes.
- `apps/api/src/modules/academics/service.ts`: re-exports the three.
- `apps/api/src/modules/academics/queries.ts`: the reads.
- `apps/api/src/modules/academics/routes.ts`: 14 routes, all declared with `access: { action }`.
- `apps/api/src/modules/academics/index.ts`: what other modules may use.
- `apps/api/test/academics-helpers.ts`, `academics-schema.test.ts`, `academics-years.test.ts`, `academics-programmes.test.ts`, `academics-classes.test.ts`, `academics-routes.test.ts`, `academics-pack.test.ts`.

**Modify (API)**
- `apps/api/src/core/permissions/matrix.ts`: one new row.
- `apps/api/test/permission-matrix.test.ts`: independent rules for the new row.
- `apps/api/src/app.ts`: register the routes.
- `apps/api/src/core/config/pack.ts`: the optional `academics` block.
- `packs/royal-softech/pack.json`, `packs/sample-basic-school/pack.json`: placeholder levels.
- Generated: `docs/permission-matrix.md`, `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`.

**Create (web)** under `apps/web/src/setup/`: `model.ts`, `client.ts`, `useLoad.tsx`, `SetupLayout.tsx`, `SetupOverview.tsx`, `YearsScreen.tsx`, `ProgrammesScreen.tsx`, `ClassesScreen.tsx`, `TerminalsScreen.tsx`, `setup.module.css`; pages under `apps/web/src/app/portal/setup/` (`page.tsx`, `years/page.tsx`, `programmes/page.tsx`, `classes/page.tsx`, `terminals/page.tsx`); tests `apps/web/test/setup-model.test.ts`, `setup-client.test.ts`, `setup-screens.test.tsx`.

**Modify (web):** `src/i18n/messages.ts`, `src/shell/nav.ts`, `test/nav.test.ts`, `src/content/client.ts` (export `toAd`).

**Docs:** `docs/data-model.md`, `docs/DECISIONS.md` (D-057), `docs/build-plan.md`, `CLAUDE.md` status line.

---

### Task 1: The tables, and the database's own rules

**Files:**
- Create: `apps/api/migrations/0009_academic_structure.sql`
- Test: `apps/api/test/academics-schema.test.ts`

**Interfaces:**
- Produces: tables `academic_years`, `programmes`, `levels`, `classes`, `terminals` with the columns below. Later tasks rely on these exact names.

| Table | Columns |
|---|---|
| `academic_years` | `id`, `public_id`, `bs_year`, `label`, `start_date`, `end_date`, `status` (`draft`/`active`/`closed`), `created_at`, `closed_at` |
| `programmes` | `id`, `public_id`, `key`, `name`, `section_id`, `affiliation`, `ordering`, `is_active` |
| `levels` | `id`, `public_id`, `programme_id`, `ordinal`, `name`, `is_active` |
| `classes` | `id`, `public_id`, `academic_year_id`, `programme_id`, `level_id`, `label` (`''` when none), `is_active` |
| `terminals` | `id`, `public_id`, `academic_year_id`, `name`, `ordinal` |

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/academics-schema.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
let yearCounter = 2000;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
const at = "2026-09-21T00:00:00.000Z";

async function addYear(status: "draft" | "active" | "closed" = "draft", extra: { start?: string; end?: string; closedAt?: string | null } = {}): Promise<number> {
  const closedAt = extra.closedAt !== undefined ? extra.closedAt : status === "closed" ? at : null;
  const result = await db
    .prepare(
      `INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at, closed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(uniq("y"), ++yearCounter, uniq("label"), extra.start ?? "2026-04-14", extra.end ?? "2027-04-13", status, at, closedAt)
    .run();
  return result.meta.last_row_id;
}

async function addSection(): Promise<number> {
  const result = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run();
  return result.meta.last_row_id;
}

async function addProgramme(): Promise<number> {
  const sectionId = await addSection();
  const result = await db
    .prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, 'Programme', ?3, 'Board')")
    .bind(uniq("p"), uniq("key"), sectionId)
    .run();
  return result.meta.last_row_id;
}

async function addLevel(programmeId: number, ordinal = 1): Promise<number> {
  const result = await db
    .prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) VALUES (?1, ?2, ?3, 'Level')")
    .bind(uniq("l"), programmeId, ordinal)
    .run();
  return result.meta.last_row_id;
}

const addClass = (yearId: number, programmeId: number, levelId: number, label = "") =>
  db
    .prepare("INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(uniq("c"), yearId, programmeId, levelId, label)
    .run();

const addTerminal = (yearId: number, ordinal: number) =>
  db.prepare("INSERT INTO terminals (public_id, academic_year_id, name, ordinal) VALUES (?1, ?2, 'First terminal', ?3)").bind(uniq("t"), yearId, ordinal).run();

// ---------------------------------------------------------------------------------------------
describe("academic_years", () => {
  it("allows only one active year", async () => {
    await addYear("active");
    await expect(addYear("active")).rejects.toThrow(/UNIQUE/);
    await addYear("draft"); // drafts are not limited
  });

  it("refuses a year that does not end after it starts", async () => {
    await expect(addYear("draft", { start: "2027-04-13", end: "2027-04-13" })).rejects.toThrow(/CHECK/);
    await expect(addYear("draft", { start: "2027-04-14", end: "2027-04-13" })).rejects.toThrow(/CHECK/);
  });

  it("refuses a date that is not written YYYY-MM-DD", async () => {
    await expect(addYear("draft", { start: "14/04/2026" })).rejects.toThrow(/CHECK/);
  });

  it("closed_at is set exactly when the year is closed", async () => {
    await expect(addYear("closed", { closedAt: null })).rejects.toThrow(/CHECK/);
    await expect(addYear("draft", { closedAt: at })).rejects.toThrow(/CHECK/);
  });

  it("a closed year cannot be changed at all", async () => {
    const id = await addYear("closed");
    await expect(db.prepare("UPDATE academic_years SET label = 'new' WHERE id = ?1").bind(id).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE academic_years SET status = 'draft', closed_at = NULL WHERE id = ?1").bind(id).run()).rejects.toThrow(/academic year is closed/);
  });

  it("a draft year can be edited and can become active, then closed", async () => {
    const id = await addYear("draft");
    await db.prepare("UPDATE academic_years SET label = 'edited' WHERE id = ?1").bind(id).run();
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(id, at).run();
  });
});

// ---------------------------------------------------------------------------------------------
describe("classes", () => {
  it("takes a level together with that level's own programme", async () => {
    const yearId = await addYear();
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(yearId, programmeId, levelId);
  });

  it("refuses a level paired with another programme", async () => {
    const yearId = await addYear();
    const programmeA = await addProgramme();
    const programmeB = await addProgramme();
    const levelOfA = await addLevel(programmeA);
    await expect(addClass(yearId, programmeB, levelOfA)).rejects.toThrow(/FOREIGN KEY/);
  });

  it("refuses the same class twice, including two with no label", async () => {
    const yearId = await addYear();
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(yearId, programmeId, levelId, "");
    await expect(addClass(yearId, programmeId, levelId, "")).rejects.toThrow(/UNIQUE/);
    await addClass(yearId, programmeId, levelId, "Morning"); // a different label is a different class
    await expect(addClass(yearId, programmeId, levelId, "Morning")).rejects.toThrow(/UNIQUE/);
  });

  it("the same level in another year is another class", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(await addYear(), programmeId, levelId);
    await addClass(await addYear(), programmeId, levelId);
  });

  it("a closed year refuses a new class, a change, and a removal, whatever the service does", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const openYear = await addYear();
    await addClass(openYear, programmeId, levelId);
    const classId = (await db.prepare("SELECT id FROM classes WHERE academic_year_id = ?1").bind(openYear).first<{ id: number }>())!.id;
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(openYear, at).run();

    await expect(addClass(openYear, programmeId, await addLevel(programmeId, 2))).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE classes SET label = 'x' WHERE id = ?1").bind(classId).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("DELETE FROM classes WHERE id = ?1").bind(classId).run()).rejects.toThrow(/academic year is closed/);
  });

  it("a class cannot be moved into a closed year", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const open = await addYear();
    const closed = await addYear("closed");
    await addClass(open, programmeId, levelId);
    const classId = (await db.prepare("SELECT id FROM classes WHERE academic_year_id = ?1").bind(open).first<{ id: number }>())!.id;
    await expect(db.prepare("UPDATE classes SET academic_year_id = ?2 WHERE id = ?1").bind(classId, closed).run()).rejects.toThrow(/academic year is closed/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("levels", () => {
  it("are ordered, and an ordinal is used once per programme", async () => {
    const programmeId = await addProgramme();
    await addLevel(programmeId, 1);
    await addLevel(programmeId, 2);
    await expect(addLevel(programmeId, 2)).rejects.toThrow(/UNIQUE/);
    await addLevel(await addProgramme(), 2); // another programme may reuse it
  });

  it("refuses an ordinal outside 1 to 20", async () => {
    const programmeId = await addProgramme();
    await expect(addLevel(programmeId, 0)).rejects.toThrow(/CHECK/);
    await expect(addLevel(programmeId, 21)).rejects.toThrow(/CHECK/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("terminals", () => {
  it("an ordinal is used once per year", async () => {
    const yearId = await addYear();
    await addTerminal(yearId, 1);
    await expect(addTerminal(yearId, 1)).rejects.toThrow(/UNIQUE/);
    await addTerminal(await addYear(), 1);
  });

  it("a closed year refuses a new terminal, a change, and a removal", async () => {
    const yearId = await addYear();
    await addTerminal(yearId, 1);
    const terminalId = (await db.prepare("SELECT id FROM terminals WHERE academic_year_id = ?1").bind(yearId).first<{ id: number }>())!.id;
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(yearId, at).run();

    await expect(addTerminal(yearId, 2)).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE terminals SET name = 'x' WHERE id = ?1").bind(terminalId).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("DELETE FROM terminals WHERE id = ?1").bind(terminalId).run()).rejects.toThrow(/academic year is closed/);
  });
});

describe("programmes", () => {
  it("the key is unique and names are required", async () => {
    const sectionId = await addSection();
    const key = uniq("key");
    const insert = (name: string, k: string) =>
      db.prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, ?3, ?4, 'Board')").bind(uniq("p"), k, name, sectionId).run();
    await insert("First", key);
    await expect(insert("Second", key)).rejects.toThrow(/UNIQUE/);
    await expect(insert("", uniq("key"))).rejects.toThrow(/CHECK/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-schema.test.ts`
Expected: FAIL, "no such table: academic_years".

- [ ] **Step 3: Write the migration**

Create `apps/api/migrations/0009_academic_structure.sql`:

```sql
-- Academic structure (Phase 3, slice 1, D-056): years, programmes, levels, classes, terminals.
-- Ids shown to clients are public_id, never the integer. Dates are AD text, "YYYY-MM-DD".
-- Nothing here is deleted: rows are deactivated. A closed year rejects every write, and the triggers
-- below say so even if the service that normally checks it is bypassed (D1 has no database accounts).
-- Naming: a class's `label` (Morning, Evening) is not the institution's `sections` (+2, Bachelor's).

CREATE TABLE academic_years (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  bs_year INTEGER NOT NULL UNIQUE CHECK (bs_year BETWEEN 2000 AND 2100),
  label TEXT NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 40),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (end_date > start_date),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- At most one active year. Closing a year is Phase 8.
CREATE UNIQUE INDEX academic_years_one_active ON academic_years (status) WHERE status = 'active';

CREATE TRIGGER academic_years_closed_is_final BEFORE UPDATE ON academic_years
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed');
END;

CREATE TABLE programmes (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 60),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  section_id INTEGER NOT NULL REFERENCES sections (id),
  affiliation TEXT NOT NULL CHECK (length(affiliation) BETWEEN 1 AND 120),
  ordering INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE levels (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  programme_id INTEGER NOT NULL REFERENCES programmes (id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (programme_id, ordinal),
  UNIQUE (id, programme_id)          -- lets a class point at a level and its programme together
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  programme_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 40),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  FOREIGN KEY (level_id, programme_id) REFERENCES levels (id, programme_id),
  UNIQUE (academic_year_id, level_id, label)
);

CREATE TABLE terminals (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 12),
  UNIQUE (academic_year_id, ordinal)
);

CREATE TRIGGER classes_year_open_insert BEFORE INSERT ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER classes_year_open_update BEFORE UPDATE ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed'
      OR (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER classes_year_open_delete BEFORE DELETE ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_insert BEFORE INSERT ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_update BEFORE UPDATE ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed'
      OR (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_delete BEFORE DELETE ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
END;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-schema.test.ts`
Expected: PASS (all). If a `/FOREIGN KEY/` or trigger-message assertion fails because the runtime words it differently, print the actual message once (`console.log(error.message)` in a scratch test), and change only the regular expression in the test to match, keeping the meaning.

- [ ] **Step 5: Run the whole API suite (the new tables must not disturb anything)**

Run: `cd apps/api && npx vitest run`
Expected: PASS (819 existing tests plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0009_academic_structure.sql apps/api/test/academics-schema.test.ts
git commit -m "Slice 1: the academic structure tables, with closed-year triggers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The permission row for viewing the structure

**Files:**
- Modify: `apps/api/src/core/permissions/matrix.ts` (Setup group, after `setup.assignments.manage`)
- Modify: `apps/api/test/permission-matrix.test.ts` (the `exactly` table and one new `it`)
- Regenerate: `docs/permission-matrix.md`

**Interfaces:**
- Produces: action id `setup.structure.view` (Co-ordinator `inst`, Admin `read`, Super Admin `all`). `setup.structure.manage` already exists (Co-ordinator `inst`, Super Admin `all`).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/permission-matrix.test.ts`, inside the `exactly` object (after the line `"students.rollover": ["COO", "SUP"],`), add:

```ts
    // Only the Co-ordinator sets up the academic structure. The Admin may look, never change it.
    "setup.structure.manage": ["COO", "SUP"],
    "setup.structure.view": ["COO", "ADM", "SUP"],
```

and, after the test `"a Co-ordinator may deactivate Teachers only; an Admin only Co-ordinators and Accountants"`, add:

```ts
  it("the Admin can look at the academic structure but not change it", () => {
    expect(authorize([claim("ADM")], "setup.structure.view")!.readOnly).toBe(true);
    expect(authorize([claim("ADM")], "setup.structure.manage")).toBeNull();
    expect(authorize([claim("COO")], "setup.structure.view")!.readOnly).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/permission-matrix.test.ts`
Expected: FAIL: `setup.structure.view exists` is false.

- [ ] **Step 3: Add the row**

In `apps/api/src/core/permissions/matrix.ts`, directly after the line beginning `row(G.setup, "setup.structure.manage", ...`, add:

```ts
  row(G.setup, "setup.structure.view", "View academic years, programmes, levels, classes, terminals", 3, { COO: inst, ADM: read, SUP: all }),
```

- [ ] **Step 4: Run to verify it passes, then regenerate the document**

Run: `cd apps/api && npx vitest run test/permission-matrix.test.ts test/permission-routes.test.ts`
Expected: PASS.

Run: `cd apps/api && npm run gen:permissions` then `git diff --stat ../../docs/permission-matrix.md`
Expected: `docs/permission-matrix.md` changed by a few lines (the new row).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/permissions/matrix.ts apps/api/test/permission-matrix.test.ts docs/permission-matrix.md
git commit -m "Slice 1: a permission to view the academic structure (Admin read-only)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Shared write plumbing, test helpers, and the academic year service

**Files:**
- Create: `apps/api/src/modules/academics/guard.ts`, `write.ts`, `schema.ts`, `years.ts`, `service.ts`
- Create: `apps/api/test/academics-helpers.ts`
- Test: `apps/api/test/academics-years.test.ts`

**Interfaces:**
- Produces (used by Tasks 4 to 7):
  - `coordinatorForSection(n: number, sectionId: string): string` and `coordinatorForInstitution(n: number): string`, SQL fragments where `?n` is the actor's public id.
  - `type Failure = { ok: false; reason: "not_allowed" | "not_found" | "year_closed" | "conflict" | "not_draft" | "another_active" } | { ok: false; reason: "invalid"; message: string }`, `type Done = { ok: true } | Failure`, `type Created = { ok: true; publicId: string } | Failure`.
  - `write(db, auditKey, event, statement): Promise<"done" | "not_applied" | "duplicate" | "year_closed" | "check_failed">`.
  - `firstMessage(error)`.
  - Years: `createYear(db, auditKey, actor, input, now?)`, `updateYear(db, auditKey, actor, publicId, changes)`, `activateYear(db, auditKey, actor, publicId, now?)`.
  - Test helpers: `db`, `auditKey`, `app`, `seedSections()`, `person(role, scope, section?)`, `call(path, init)`, `count(sql, ...params)`.

- [ ] **Step 1: Write the test helpers**

Create `apps/api/test/academics-helpers.ts`:

```ts
import { env } from "cloudflare:test";

import { createApp } from "../src/app";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";

export const db = env.DB;
export const auditKey = env.AUDIT_HMAC_KEY;
export const app = createApp();
const password = "blue-river-lamp-2083";

/** The two sections the tests use. Safe to call in every file: it only adds what is missing. */
export async function seedSections(): Promise<void> {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO sections (key, name, ordering) VALUES ('plus2', '+2', 0)"),
    db.prepare("INSERT OR IGNORE INTO sections (key, name, ordering) VALUES ('bachelors', 'Bachelor''s', 1)"),
  ]);
}

export interface Person {
  publicId: string;
  cookie: string;
}

let n = 0;
/** A real account with one role assignment, and a signed sign-in cookie for it (as the browser would hold). */
export async function person(role: string, scope: string, section?: string): Promise<Person> {
  const email = `${role}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, auditKey, {
    email,
    password,
    fullName: `${role} person`,
    roles: [{ role: role as never, scope: scope as never, ...(section ? { sectionKey: section } : {}) }],
  });
  const claim = { role, scope, ...(section ? { section } : {}) } as RoleClaim;
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [claim], iat: now, exp: now + 600 });
  return { publicId, cookie: `__Host-access=${token}` };
}

export const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

export const count = async (sql: string, ...params: (string | number)[]): Promise<number> =>
  (await db.prepare(sql).bind(...params).first<{ n: number }>())!.n;

export const auditActions = async (entityPublicId: string): Promise<string[]> =>
  (await db.prepare("SELECT action FROM audit_events WHERE entity_public_id = ?1 ORDER BY id").bind(entityPublicId).all<{ action: string }>()).results.map((r) => r.action);
```

- [ ] **Step 2: Write the failing year tests**

Create `apps/api/test/academics-years.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { activateYear, createYear, updateYear } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let bs = 2010;
/** A BS year not used yet in this file: its first and last day, from the verified calendar. */
const freshYear = (over: Record<string, unknown> = {}) => {
  const bsYear = ++bs;
  return {
    bsYear,
    startDate: bsToAd({ year: bsYear, month: 1, day: 1 }),
    endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }),
    ...over,
  } as { bsYear: number; startDate: string; endDate: string; label?: string };
};

let coordinator: Person, sectionCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  sectionCoordinator = await person("coordinator", "section", "plus2");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const years = () => count("SELECT COUNT(*) AS n FROM academic_years");
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");

// ---------------------------------------------------------------------------------------------
describe("createYear", () => {
  it("adds a draft year, names it after its BS year, and records who did it", async () => {
    const input = freshYear();
    const result = await createYear(db, auditKey, coordinator.publicId, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db.prepare("SELECT bs_year, label, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(result.publicId).first();
    expect(row).toEqual({ bs_year: input.bsYear, label: String(input.bsYear), start_date: input.startDate, end_date: input.endDate, status: "draft" });
    const entry = await db
      .prepare("SELECT a.action, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1")
      .bind(result.publicId)
      .first();
    expect(entry).toEqual({ action: "academics.year.created", actor: coordinator.publicId });
  });

  it("takes a label of the person's own choosing", async () => {
    const result = await createYear(db, auditKey, coordinator.publicId, freshYear({ label: "2083/84" }));
    expect(result.ok).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE label = '2083/84'")).toBe(1);
  });

  it("the Super Admin may too", async () => {
    expect((await createYear(db, auditKey, superAdmin.publicId, freshYear())).ok).toBe(true);
  });

  const bad: [string, () => Record<string, unknown>, RegExp][] = [
    ["a year whose calendar is not verified", () => ({ bsYear: 2090, startDate: "2033-04-14", endDate: "2034-04-13" }), /not been verified/],
    ["a start day that is not in the BS year", () => { const f = freshYear(); return { ...f, startDate: bsToAd({ year: f.bsYear + 1, month: 1, day: 1 }), endDate: bsToAd({ year: f.bsYear + 1, month: 12, day: 1 }) }; }, /not in BS/],
    ["an end that is not after the start", () => { const f = freshYear(); return { ...f, endDate: f.startDate }; }, /end after/i],
    ["a day that does not exist", () => ({ ...freshYear(), startDate: "2026-02-30" }), /does not exist/],
    ["an empty label", () => ({ ...freshYear(), label: "  " }), /name/i],
    ["a field that is not allowed (the status)", () => ({ ...freshYear(), status: "active" }), /./],
  ];
  it.each(bad)("refuses %s, and writes nothing", async (_label, make, message) => {
    const before = [await years(), await audits()];
    const result = await createYear(db, auditKey, coordinator.publicId, make() as never);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect((result as { message: string }).message).toMatch(message);
    expect([await years(), await audits()]).toEqual(before);
  });

  it("refuses everyone but an institution-wide Co-ordinator and the Super Admin, and writes nothing", async () => {
    const before = [await years(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student], ["a +2 Co-ordinator", sectionCoordinator]] as const) {
      expect(await createYear(db, auditKey, who.publicId, freshYear()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await years(), await audits()]).toEqual(before);
  });

  it("re-checks the person in the database: a switched-off account or role is refused even with a valid token", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    expect(await createYear(db, auditKey, off.publicId, freshYear())).toEqual({ ok: false, reason: "not_allowed" });

    const demoted = await person("coordinator", "institution");
    await db.prepare("UPDATE role_assignments SET is_active = 0 WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(demoted.publicId).run();
    expect(await createYear(db, auditKey, demoted.publicId, freshYear())).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("a second year with the same BS year is a conflict and leaves no false audit entry", async () => {
    const input = freshYear();
    expect((await createYear(db, auditKey, coordinator.publicId, input)).ok).toBe(true);
    const before = await audits();
    expect(await createYear(db, auditKey, coordinator.publicId, { ...input, label: "another" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateYear", () => {
  const draft = async () => {
    const r = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!r.ok) throw new Error("setup failed");
    return r.publicId;
  };

  it("changes the label and records before and after", async () => {
    const id = await draft();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { label: "Renamed" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT label FROM academic_years WHERE public_id = ?1").bind(id).first()).toEqual({ label: "Renamed" });
    expect(await auditActions(id)).toEqual(["academics.year.created", "academics.year.updated"]);
  });

  it("changing nothing records nothing", async () => {
    const id = await draft();
    const before = await audits();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, {})).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("checks the merged year again (end before start is refused, nothing changes)", async () => {
    const id = await draft();
    const start = (await db.prepare("SELECT start_date FROM academic_years WHERE public_id = ?1").bind(id).first<{ start_date: string }>())!.start_date;
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { endDate: start })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses an unknown year, another person, and a year that is no longer a draft", async () => {
    expect(await updateYear(db, auditKey, coordinator.publicId, "0".repeat(32), { label: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await draft();
    expect(await updateYear(db, auditKey, admin.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateYear(db, auditKey, sectionCoordinator.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(id).run();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_draft" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("activateYear", () => {
  it("one winner when two are activated at once; the loser is told another year is active; nothing is applied twice", async () => {
    const a = await createYear(db, auditKey, coordinator.publicId, freshYear());
    const b = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const results = await Promise.all([activateYear(db, auditKey, coordinator.publicId, a.publicId), activateYear(db, auditKey, coordinator.publicId, b.publicId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "another_active" });
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE status = 'active'")).toBe(1);

    const winner = results[0]!.ok ? a.publicId : b.publicId;
    const loser = winner === a.publicId ? b.publicId : a.publicId;
    expect(await auditActions(winner)).toContain("academics.year.activated");
    expect(await auditActions(loser)).not.toContain("academics.year.activated");

    // Already active: a repeat says so, and records nothing more.
    const before = await audits();
    expect(await activateYear(db, auditKey, coordinator.publicId, winner)).toEqual({ ok: false, reason: "not_draft" });
    expect(await audits()).toBe(before);

    // Others are refused, and an unknown id is not found.
    const c = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!c.ok) throw new Error("setup failed");
    expect(await activateYear(db, auditKey, admin.publicId, c.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await activateYear(db, auditKey, coordinator.publicId, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-years.test.ts`
Expected: FAIL: cannot find module `../src/modules/academics/service`.

- [ ] **Step 4: Write the guard**

Create `apps/api/src/modules/academics/guard.ts`:

```ts
/**
 * The person is re-checked INSIDE every write, from the database, never from the sign-in token: the
 * token can outlive a switch-off by up to 30 minutes (D-021). `?n` in each fragment is the actor's
 * public id. The alias names (`gu`, `ga`) must not clash with the aliases of the statement they sit in.
 */

/**
 * True for an active Super Admin, or an active Co-ordinator whose assignment covers the section:
 * institution-wide, or section-scoped to exactly this one. `sectionId` is an SQL expression that
 * gives the section's integer id.
 */
export const coordinatorForSection = (n: number, sectionId: string): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin'
                   OR (ga.role = 'coordinator' AND (ga.scope_type = 'institution' OR ga.section_id = ${sectionId}))))`;

/**
 * True for an active Super Admin, or an active INSTITUTION-wide Co-ordinator. For things that belong to
 * the whole school (years, terminals): a section-scoped Co-ordinator does not qualify.
 */
export const coordinatorForInstitution = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin' OR (ga.role = 'coordinator' AND ga.scope_type = 'institution')))`;
```

- [ ] **Step 5: Write the shared write helper**

Create `apps/api/src/modules/academics/write.ts`:

```ts
import { recordAudit, type AuditEventInput } from "../../core/audit";

export type Failure =
  | { ok: false; reason: "not_allowed" | "not_found" | "year_closed" | "conflict" | "not_draft" | "another_active" }
  | { ok: false; reason: "invalid"; message: string };
export type Done = { ok: true } | Failure;
export type Created = { ok: true; publicId: string } | Failure;

export const firstMessage = (error: { issues: { message: string }[] }): string => error.issues[0]?.message ?? "That is not valid";

/** What happened to one write. `not_applied`: the conditional SQL matched nothing (not allowed, missing, or a lost race). */
export type Outcome = "done" | "not_applied" | "duplicate" | "year_closed" | "check_failed";

/**
 * One change and its audit entry, in one batch. The entry is written only if the change happened, so a lost
 * race or a failed re-check leaves no false entry. The database's own refusals are turned into words.
 */
export async function write(db: D1Database, auditKey: string, event: AuditEventInput, statement: D1PreparedStatement): Promise<Outcome> {
  try {
    const { applied } = await recordAudit(db, auditKey, event, [statement], { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return "year_closed";
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    if (/CHECK constraint failed/i.test(message)) return "check_failed";
    throw error;
  }
}
```

- [ ] **Step 6: Write the year schemas**

Create `apps/api/src/modules/academics/schema.ts` (later tasks add to the end of this file):

```ts
import { z } from "@hono/zod-openapi";

/** An AD calendar day, "YYYY-MM-DD", checked against the real calendar. (Kept here, not imported from `content`: modules do not reach into each other.) */
export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That day does not exist");

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

// --- Academic years ---------------------------------------------------------------------------------

const YearLabel = z.string().trim().min(1, "Give the year a name").max(40, "Keep the name to 40 characters");

/** The whole of a year. The service checks every write against this (and against the verified calendar). */
export const YearInputSchema = z
  .strictObject({
    bsYear: z.number().int("The BS year is a whole number"),
    label: YearLabel.optional(),
    startDate: CalendarDaySchema,
    endDate: CalendarDaySchema,
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "The year must end after it starts" });
export type YearInput = z.input<typeof YearInputSchema>;

export const CreateYearSchema = YearInputSchema.openapi("CreateYear");

/** What may change while a year is still a draft. The BS year itself is fixed. */
export const YearChangesSchema = z.strictObject({ label: YearLabel, startDate: CalendarDaySchema, endDate: CalendarDaySchema }).partial().openapi("YearChanges");
export type YearChanges = z.infer<typeof YearChangesSchema>;
```

- [ ] **Step 7: Write the year service**

Create `apps/api/src/modules/academics/years.ts`:

```ts
import { adToBs, isVerifiedBsYear } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { coordinatorForInstitution } from "./guard";
import { YearChangesSchema, YearInputSchema, type YearChanges, type YearInput } from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

/** The start day must fall in the BS year it belongs to, and that year's calendar must be verified (D-014). */
function calendarProblem(bsYear: number, startDate: string): string | null {
  if (!isVerifiedBsYear(bsYear)) return `The calendar for BS ${bsYear} has not been verified`;
  try {
    if (adToBs(startDate).year !== bsYear) return `The start day is not in BS ${bsYear}`;
  } catch {
    return "That start day is outside the verified calendar";
  }
  return null;
}

interface YearRow {
  bs_year: number;
  label: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
}

/** One round trip: is the person allowed, and what is the year now? */
async function inspectYear(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db.prepare("SELECT bs_year, label, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    year: (row!.results[0] as unknown as YearRow | undefined) ?? null,
  };
}

/** Adds a year as a draft. */
export async function createYear(db: D1Database, auditKey: string, actor: string, input: YearInput, now: Date = new Date()): Promise<Created> {
  const parsed = YearInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const y = parsed.data;
  const problem = calendarProblem(y.bsYear, y.startDate);
  if (problem) return { ok: false, reason: "invalid", message: problem };

  const label = y.label ?? String(y.bsYear);
  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.created",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${label} added as a draft`,
      after: { bsYear: y.bsYear, label, startDate: y.startDate, endDate: y.endDate },
    },
    db
      .prepare(
        `INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'draft', ?6 WHERE ${coordinatorForInstitution(7)}`,
      )
      .bind(publicId, y.bsYear, label, y.startDate, y.endDate, now.toISOString(), actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_allowed" };
}

/** Changes a draft year's label or days. What is sent is merged with what is there, and the whole is checked again. */
export async function updateYear(db: D1Database, auditKey: string, actor: string, publicId: string, changes: YearChanges): Promise<Done> {
  const parsedChanges = YearChangesSchema.safeParse(changes);
  if (!parsedChanges.success) return { ok: false, reason: "invalid", message: firstMessage(parsedChanges.error) };

  const { allowed, year } = await inspectYear(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!year) return { ok: false, reason: "not_found" };
  if (year.status !== "draft") return { ok: false, reason: "not_draft" };

  const before = { bsYear: year.bs_year, label: year.label, startDate: year.start_date, endDate: year.end_date };
  const c = parsedChanges.data;
  const merged = { bsYear: year.bs_year, label: c.label ?? year.label, startDate: c.startDate ?? year.start_date, endDate: c.endDate ?? year.end_date };
  const parsed = YearInputSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const problem = calendarProblem(merged.bsYear, merged.startDate);
  if (problem) return { ok: false, reason: "invalid", message: problem };
  if (JSON.stringify(merged) === JSON.stringify(before)) return { ok: true }; // nothing to change, nothing to record

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.updated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${merged.label} changed`,
      before,
      after: merged,
    },
    db
      .prepare(
        `UPDATE academic_years SET label = ?2, start_date = ?3, end_date = ?4
          WHERE public_id = ?1 AND status = 'draft' AND ${coordinatorForInstitution(5)}`,
      )
      .bind(publicId, merged.label, merged.startDate, merged.endDate, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };

  const again = await inspectYear(db, publicId, actor);
  if (!again.allowed) return { ok: false, reason: "not_allowed" };
  return again.year && again.year.status !== "draft" ? { ok: false, reason: "not_draft" } : { ok: false, reason: "not_allowed" };
}

/**
 * Makes a draft year the active one. Only one year is active at a time (closing a year is Phase 8), so this is
 * refused while another is. Two people doing it at once: one wins, the other is told another year is active.
 */
export async function activateYear(db: D1Database, auditKey: string, actor: string, publicId: string, now: Date = new Date()): Promise<Done> {
  const first = await inspectYear(db, publicId, actor);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.year) return { ok: false, reason: "not_found" };
  if (first.year.status !== "draft") return { ok: false, reason: "not_draft" };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.activated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic year ${first.year.label} made the active year`,
      before: { status: "draft" },
      after: { status: "active", at: now.toISOString() },
    },
    db
      .prepare(
        `UPDATE academic_years SET status = 'active'
          WHERE public_id = ?1 AND status = 'draft'
            AND NOT EXISTS (SELECT 1 FROM academic_years WHERE status = 'active')
            AND ${coordinatorForInstitution(2)}`,
      )
      .bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "another_active" }; // the one-active index caught a race

  const second = await inspectYear(db, publicId, actor);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.year && second.year.status !== "draft" ? { ok: false, reason: "not_draft" } : { ok: false, reason: "another_active" };
}
```

- [ ] **Step 8: Write the service index**

Create `apps/api/src/modules/academics/service.ts`:

```ts
/** All writes to the academic structure. Other modules import from here (or `index`), never from the files behind it. */
export * from "./years";
export type { Created, Done, Failure } from "./write";
```

(Tasks 4 and 5 add two more `export *` lines.)

- [ ] **Step 9: Run to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-years.test.ts`
Expected: PASS. If the "unknown field" case fails because a message regex is too strict, keep its `/./`; if the race test shows both succeeding, stop: the one-active index or the `NOT EXISTS` guard is wrong, do not weaken the test.

- [ ] **Step 10: Typecheck and lint**

Run: `cd apps/api && npx tsc --noEmit && npx eslint src/modules/academics test/academics-helpers.ts test/academics-years.test.ts`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/academics apps/api/test/academics-helpers.ts apps/api/test/academics-years.test.ts
git commit -m "Slice 1: academic years (add, edit while draft, activate) with in-batch role checks" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Programmes and levels

**Files:**
- Modify: `apps/api/src/modules/academics/schema.ts` (append), `apps/api/src/modules/academics/service.ts` (one line)
- Create: `apps/api/src/modules/academics/programmes.ts`
- Test: `apps/api/test/academics-programmes.test.ts`

**Interfaces:**
- Consumes: `coordinatorForSection`, `write`, `firstMessage`, `Created`, `Done` (Task 3).
- Produces:
  - `createProgramme(db, auditKey, actor, input: ProgrammeInput): Promise<Created>` (input `{ name, sectionKey, affiliation }`).
  - `updateProgramme(db, auditKey, actor, publicId, changes: ProgrammeChanges): Promise<Done>` (`name?`, `affiliation?`, `active?`).
  - `addLevel(db, auditKey, actor, programmeId, input: LevelInput): Promise<Created>` (input `{ name }`; the ordinal is the next free one).
  - `updateLevel(db, auditKey, actor, levelId, changes: LevelChanges): Promise<Done>` (`name?`, `active?`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/academics-programmes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { addLevel, createProgramme, updateLevel, updateProgramme } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
const rows = () => count("SELECT (SELECT COUNT(*) FROM programmes) + (SELECT COUNT(*) FROM levels) AS n");
const input = (over: Record<string, unknown> = {}) => ({ name: "BBS", sectionKey: "bachelors", affiliation: "TU", ...over });

async function newProgramme(who: Person = coordinator, over: Record<string, unknown> = {}): Promise<string> {
  const result = await createProgramme(db, auditKey, who.publicId, input(over));
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.publicId;
}

// ---------------------------------------------------------------------------------------------
describe("createProgramme", () => {
  it("adds an active programme in its section, in order, and records who did it", async () => {
    const first = await newProgramme();
    const second = await newProgramme(coordinator, { name: "BBA", sectionKey: "bachelors" });
    const row = await db
      .prepare("SELECT p.name, p.affiliation, p.is_active, s.key AS section, p.ordering FROM programmes p JOIN sections s ON s.id = p.section_id WHERE p.public_id = ?1")
      .bind(first)
      .first<{ name: string; affiliation: string; is_active: number; section: string; ordering: number }>();
    expect(row).toMatchObject({ name: "BBS", affiliation: "TU", is_active: 1, section: "bachelors" });
    const next = await db.prepare("SELECT ordering FROM programmes WHERE public_id = ?1").bind(second).first<{ ordering: number }>();
    expect(next!.ordering).toBeGreaterThan(row!.ordering);
    expect(await auditActions(first)).toEqual(["academics.programme.created"]);
  });

  it("a section-scoped Co-ordinator may create only in their own section, and nothing is written when refused", async () => {
    expect((await createProgramme(db, auditKey, plus2Coordinator.publicId, input({ sectionKey: "plus2" }))).ok).toBe(true);
    expect((await createProgramme(db, auditKey, bachelorsCoordinator.publicId, input({ sectionKey: "bachelors" }))).ok).toBe(true);

    const before = [await rows(), await audits()];
    expect(await createProgramme(db, auditKey, plus2Coordinator.publicId, input({ sectionKey: "bachelors" }))).toEqual({ ok: false, reason: "not_allowed" });
    expect(await createProgramme(db, auditKey, bachelorsCoordinator.publicId, input({ sectionKey: "plus2" }))).toEqual({ ok: false, reason: "not_allowed" });
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("an institution-wide Co-ordinator may create in any section", async () => {
    expect((await createProgramme(db, auditKey, coordinator.publicId, input({ sectionKey: "plus2" }))).ok).toBe(true);
  });

  it("refuses an unknown section", async () => {
    expect(await createProgramme(db, auditKey, coordinator.publicId, input({ sectionKey: "nowhere" }))).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    ["an empty name", { name: " " }],
    ["an empty affiliation", { affiliation: "" }],
    ["a name that is too long", { name: "x".repeat(121) }],
    ["a section written in capitals", { sectionKey: "Plus 2" }],
    ["a field that is not allowed", { key: "mine" }],
  ])("refuses %s, and writes nothing", async (_label, over) => {
    const before = [await rows(), await audits()];
    expect(await createProgramme(db, auditKey, coordinator.publicId, input(over) as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("refuses every other role, and a switched-off Co-ordinator, and writes nothing", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await rows(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createProgramme(db, auditKey, who.publicId, input()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await createProgramme(db, auditKey, off.publicId, input())).toEqual({ ok: false, reason: "not_allowed" });
    expect([await rows(), await audits()]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateProgramme", () => {
  it("renames, and deactivates, with before and after in the audit entry", async () => {
    const id = await newProgramme();
    expect(await updateProgramme(db, auditKey, coordinator.publicId, id, { name: "BBS (4 years)" })).toEqual({ ok: true });
    expect(await updateProgramme(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, is_active FROM programmes WHERE public_id = ?1").bind(id).first()).toEqual({ name: "BBS (4 years)", is_active: 0 });
    expect(await auditActions(id)).toEqual(["academics.programme.created", "academics.programme.updated", "academics.programme.updated"]);
  });

  it("changing nothing records nothing", async () => {
    const id = await newProgramme();
    const before = await audits();
    expect(await updateProgramme(db, auditKey, coordinator.publicId, id, { name: "BBS" })).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("another section's Co-ordinator is refused, even with the right id, and the programme is untouched", async () => {
    const id = await newProgramme(coordinator, { sectionKey: "bachelors" });
    expect(await updateProgramme(db, auditKey, plus2Coordinator.publicId, id, { name: "Hijacked" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateProgramme(db, auditKey, bachelorsCoordinator.publicId, id, { name: "Ours" })).toEqual({ ok: true });
    expect(await updateProgramme(db, auditKey, admin.publicId, id, { name: "Nope" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await db.prepare("SELECT name FROM programmes WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Ours" });
  });

  it("an unknown programme is not found", async () => {
    expect(await updateProgramme(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("addLevel", () => {
  it("numbers levels 1, 2, 3 in the order they are added", async () => {
    const id = await newProgramme();
    for (const name of ["Year 1", "Year 2", "Year 3"]) expect((await addLevel(db, auditKey, coordinator.publicId, id, { name })).ok).toBe(true);
    const levels = (await db.prepare("SELECT l.ordinal, l.name FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.public_id = ?1 ORDER BY l.ordinal").bind(id).all()).results;
    expect(levels).toEqual([{ ordinal: 1, name: "Year 1" }, { ordinal: 2, name: "Year 2" }, { ordinal: 3, name: "Year 3" }]);
  });

  it("numbers levels added at the same moment without a clash", async () => {
    const id = await newProgramme();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => addLevel(db, auditKey, coordinator.publicId, id, { name: `Level ${n}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    const ordinals = (await db.prepare("SELECT l.ordinal FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.public_id = ?1 ORDER BY l.ordinal").bind(id).all<{ ordinal: number }>()).results.map((r) => r.ordinal);
    expect(ordinals).toEqual([1, 2, 3, 4, 5]);
  });

  it("a Co-ordinator of another section cannot add a level, even with the right id", async () => {
    const id = await newProgramme(coordinator, { sectionKey: "bachelors" });
    const before = [await rows(), await audits()];
    expect(await addLevel(db, auditKey, plus2Coordinator.publicId, id, { name: "Year 1" })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("refuses an unknown programme, an inactive one, an empty name, and a 21st level", async () => {
    expect(await addLevel(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "Year 1" })).toEqual({ ok: false, reason: "not_found" });

    const off = await newProgramme();
    await updateProgramme(db, auditKey, coordinator.publicId, off, { active: false });
    expect(await addLevel(db, auditKey, coordinator.publicId, off, { name: "Year 1" })).toMatchObject({ ok: false, reason: "invalid" });

    const id = await newProgramme();
    expect(await addLevel(db, auditKey, coordinator.publicId, id, { name: " " })).toMatchObject({ ok: false, reason: "invalid" });
    for (let n = 1; n <= 20; n++) expect((await addLevel(db, auditKey, coordinator.publicId, id, { name: `L${n}` })).ok).toBe(true);
    expect(await addLevel(db, auditKey, coordinator.publicId, id, { name: "L21" })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/at most 20/) });
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateLevel", () => {
  const level = async (programmeId: string, name = "Year 1") => {
    const r = await addLevel(db, auditKey, coordinator.publicId, programmeId, { name });
    if (!r.ok) throw new Error("setup failed");
    return r.publicId;
  };

  it("renames and deactivates a level, and records it", async () => {
    const levelId = await level(await newProgramme());
    expect(await updateLevel(db, auditKey, coordinator.publicId, levelId, { name: "First year" })).toEqual({ ok: true });
    expect(await updateLevel(db, auditKey, coordinator.publicId, levelId, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, is_active FROM levels WHERE public_id = ?1").bind(levelId).first()).toEqual({ name: "First year", is_active: 0 });
    expect(await auditActions(levelId)).toEqual(["academics.level.created", "academics.level.updated", "academics.level.updated"]);
  });

  it("another section's Co-ordinator, the Admin and an unknown id are refused", async () => {
    const levelId = await level(await newProgramme(coordinator, { sectionKey: "bachelors" }));
    expect(await updateLevel(db, auditKey, plus2Coordinator.publicId, levelId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateLevel(db, auditKey, admin.publicId, levelId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateLevel(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    expect(await db.prepare("SELECT name FROM levels WHERE public_id = ?1").bind(levelId).first()).toEqual({ name: "Year 1" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-programmes.test.ts`
Expected: FAIL: `createProgramme` is not exported.

- [ ] **Step 3: Append the schemas**

Append to the end of `apps/api/src/modules/academics/schema.ts`:

```ts

// --- Programmes and levels ---------------------------------------------------------------------------

const ProgrammeName = z.string().trim().min(1, "Give the programme a name").max(120, "Keep the name to 120 characters");
const Affiliation = z.string().trim().min(1, "Give the affiliation, for example NEB").max(120, "Keep the affiliation to 120 characters");
const LevelName = z.string().trim().min(1, "Give the level a name").max(60, "Keep the name to 60 characters");

export const CreateProgrammeSchema = z
  .strictObject({ name: ProgrammeName, sectionKey: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "Choose a section"), affiliation: Affiliation })
  .openapi("CreateProgramme");
export type ProgrammeInput = z.input<typeof CreateProgrammeSchema>;

export const ProgrammeChangesSchema = z.strictObject({ name: ProgrammeName, affiliation: Affiliation, active: z.boolean() }).partial().openapi("ProgrammeChanges");
export type ProgrammeChanges = z.infer<typeof ProgrammeChangesSchema>;

export const CreateLevelSchema = z.strictObject({ name: LevelName }).openapi("CreateLevel");
export type LevelInput = z.input<typeof CreateLevelSchema>;

export const LevelChangesSchema = z.strictObject({ name: LevelName, active: z.boolean() }).partial().openapi("LevelChanges");
export type LevelChanges = z.infer<typeof LevelChangesSchema>;
```

- [ ] **Step 4: Write the programme and level service**

Create `apps/api/src/modules/academics/programmes.ts`:

```ts
import { newPublicId } from "../../core/ids";
import { coordinatorForSection } from "./guard";
import {
  CreateLevelSchema,
  CreateProgrammeSchema,
  LevelChangesSchema,
  ProgrammeChangesSchema,
  type LevelChanges,
  type LevelInput,
  type ProgrammeChanges,
  type ProgrammeInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

interface ProgrammeRow {
  name: string;
  affiliation: string;
  is_active: number;
}

/** One round trip: may the person act on this programme's section, and what is the programme now? */
async function inspectProgramme(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForSection(1, "(SELECT section_id FROM programmes WHERE public_id = ?2)")} AS ok`).bind(actor, publicId),
    db.prepare("SELECT name, affiliation, is_active FROM programmes WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    programme: (row!.results[0] as unknown as ProgrammeRow | undefined) ?? null,
  };
}

/** Adds a programme to a section. The key is generated: pack programmes keep the key the pack gave them. */
export async function createProgramme(db: D1Database, auditKey: string, actor: string, input: ProgrammeInput): Promise<Created> {
  const parsed = CreateProgrammeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;

  const publicId = newPublicId();
  const key = `p${publicId.slice(0, 10)}`;
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.programme.created",
      entityType: "programme",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Programme "${p.name}" added`,
      after: p,
    },
    db
      .prepare(
        `INSERT INTO programmes (public_id, key, name, section_id, affiliation, ordering)
         SELECT ?1, ?2, ?3, s.id, ?5, COALESCE((SELECT MAX(ordering) FROM programmes), 0) + 1
           FROM sections s
          WHERE s.key = ?4 AND ${coordinatorForSection(6, "s.id")}`,
      )
      .bind(publicId, key, p.name, p.sectionKey, p.affiliation, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  const section = await db.prepare("SELECT id FROM sections WHERE key = ?1").bind(p.sectionKey).first();
  return { ok: false, reason: section ? "not_allowed" : "not_found" };
}

/** Renames a programme, changes its affiliation, or switches it off and on. Nothing is deleted. */
export async function updateProgramme(db: D1Database, auditKey: string, actor: string, publicId: string, changes: ProgrammeChanges): Promise<Done> {
  const parsed = ProgrammeChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, programme } = await inspectProgramme(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!programme) return { ok: false, reason: "not_found" };

  const before = { name: programme.name, affiliation: programme.affiliation, active: programme.is_active === 1 };
  const after = { name: c.name ?? before.name, affiliation: c.affiliation ?? before.affiliation, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.programme.updated",
      entityType: "programme",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Programme "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(
        `UPDATE programmes SET name = ?2, affiliation = ?3, is_active = ?4
          WHERE public_id = ?1 AND ${coordinatorForSection(5, "programmes.section_id")}`,
      )
      .bind(publicId, after.name, after.affiliation, after.active ? 1 : 0, actor),
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_allowed" };
}

/** Adds a level to a programme, numbered after the last one. Two added at once get different numbers. */
export async function addLevel(db: D1Database, auditKey: string, actor: string, programmeId: string, input: LevelInput): Promise<Created> {
  const parsed = CreateLevelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.level.created",
      entityType: "level",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Level "${parsed.data.name}" added`,
      after: { programmeId, name: parsed.data.name },
    },
    db
      .prepare(
        `INSERT INTO levels (public_id, programme_id, ordinal, name)
         SELECT ?1, p.id, COALESCE((SELECT MAX(ordinal) FROM levels WHERE programme_id = p.id), 0) + 1, ?3
           FROM programmes p
          WHERE p.public_id = ?2 AND p.is_active = 1 AND ${coordinatorForSection(4, "p.section_id")}`,
      )
      .bind(publicId, programmeId, parsed.data.name, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "A programme can have at most 20 levels" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };

  const { allowed, programme } = await inspectProgramme(db, programmeId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!programme) return { ok: false, reason: "not_found" };
  if (programme.is_active === 0) return { ok: false, reason: "invalid", message: "That programme is switched off" };
  return { ok: false, reason: "not_allowed" };
}

interface LevelRow {
  name: string;
  is_active: number;
}

async function inspectLevel(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db
      .prepare(
        `SELECT ${coordinatorForSection(1, "(SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?2)")} AS ok`,
      )
      .bind(actor, publicId),
    db.prepare("SELECT name, is_active FROM levels WHERE public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    level: (row!.results[0] as unknown as LevelRow | undefined) ?? null,
  };
}

/** Renames a level or switches it off and on. Nothing is deleted. */
export async function updateLevel(db: D1Database, auditKey: string, actor: string, publicId: string, changes: LevelChanges): Promise<Done> {
  const parsed = LevelChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, level } = await inspectLevel(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!level) return { ok: false, reason: "not_found" };

  const before = { name: level.name, active: level.is_active === 1 };
  const after = { name: c.name ?? before.name, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.level.updated",
      entityType: "level",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Level "${after.name}" changed`,
      before,
      after,
    },
    db
      .prepare(
        `UPDATE levels SET name = ?2, is_active = ?3
          WHERE public_id = ?1 AND ${coordinatorForSection(4, "(SELECT section_id FROM programmes WHERE id = levels.programme_id)")}`,
      )
      .bind(publicId, after.name, after.active ? 1 : 0, actor),
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_allowed" };
}
```

- [ ] **Step 5: Export it**

In `apps/api/src/modules/academics/service.ts`, add after the `export * from "./years";` line:

```ts
export * from "./programmes";
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-programmes.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/api && npx tsc --noEmit && npx eslint src/modules/academics test/academics-programmes.test.ts`
Expected: no output.

```bash
git add apps/api/src/modules/academics apps/api/test/academics-programmes.test.ts
git commit -m "Slice 1: programmes and levels, scoped to the Co-ordinator's section" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Classes and terminals

**Files:**
- Modify: `apps/api/src/modules/academics/schema.ts` (append), `apps/api/src/modules/academics/service.ts` (one line)
- Create: `apps/api/src/modules/academics/classes.ts`
- Test: `apps/api/test/academics-classes.test.ts`

**Interfaces:**
- Consumes: `coordinatorForSection`, `coordinatorForInstitution`, `write`, `firstMessage`, `Created`, `Done`; from Tasks 3 and 4: `createYear`, `createProgramme`, `addLevel`.
- Produces:
  - `createClass(db, auditKey, actor, input: ClassInput): Promise<Created>` (input `{ yearId, levelId, label? }`).
  - `updateClass(db, auditKey, actor, publicId, changes: ClassChanges): Promise<Done>` (`label?`, `active?`).
  - `createTerminal(db, auditKey, actor, input: TerminalInput): Promise<Created>` (input `{ yearId, name }`; the ordinal is the next free one).
  - `updateTerminal(db, auditKey, actor, publicId, changes: TerminalChanges): Promise<Done>` (`name?`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/academics-classes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { addLevel, createClass, createProgramme, createTerminal, createYear, updateClass, updateLevel, updateTerminal } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
const classes = () => count("SELECT COUNT(*) AS n FROM classes");
const terminals = () => count("SELECT COUNT(*) AS n FROM terminals");

let bs = 2010;
async function newYear(): Promise<string> {
  const bsYear = ++bs;
  const r = await createYear(db, auditKey, coordinator.publicId, {
    bsYear,
    startDate: bsToAd({ year: bsYear, month: 1, day: 1 }),
    endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }),
  });
  if (!r.ok) throw new Error(`year setup failed: ${r.reason}`);
  return r.publicId;
}
const closeYear = (publicId: string) =>
  db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(publicId).run();

/** A programme with one level, in the given section. */
async function newLevel(sectionKey: "plus2" | "bachelors" = "bachelors"): Promise<{ programmeId: string; levelId: string }> {
  const p = await createProgramme(db, auditKey, coordinator.publicId, { name: "Programme", sectionKey, affiliation: "Board" });
  if (!p.ok) throw new Error("programme setup failed");
  const l = await addLevel(db, auditKey, coordinator.publicId, p.publicId, { name: "Level 1" });
  if (!l.ok) throw new Error("level setup failed");
  return { programmeId: p.publicId, levelId: l.publicId };
}

// ---------------------------------------------------------------------------------------------
describe("createClass", () => {
  it("adds a class of a level in a year, with no label unless one is given, and records who did it", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const result = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db
      .prepare(
        `SELECT c.label, c.is_active, y.public_id AS year, l.public_id AS level, c.programme_id = l.programme_id AS same_programme
           FROM classes c JOIN academic_years y ON y.id = c.academic_year_id JOIN levels l ON l.id = c.level_id WHERE c.public_id = ?1`,
      )
      .bind(result.publicId)
      .first();
    expect(row).toEqual({ label: "", is_active: 1, year: yearId, level: levelId, same_programme: 1 });
    expect(await auditActions(result.publicId)).toEqual(["academics.class.created"]);
  });

  it("the same level in the same year needs a different label; a repeat is a conflict with no false audit entry", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).ok).toBe(true);
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" })).ok).toBe(true);
    const before = await audits();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "conflict" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });

  it("a section-scoped Co-ordinator may make classes only of their own section's programmes", async () => {
    const yearId = await newYear();
    const bachelors = await newLevel("bachelors");
    const plus2 = await newLevel("plus2");
    const before = [await classes(), await audits()];
    expect(await createClass(db, auditKey, plus2Coordinator.publicId, { yearId, levelId: bachelors.levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await createClass(db, auditKey, bachelorsCoordinator.publicId, { yearId, levelId: plus2.levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await classes(), await audits()]).toEqual(before);
    expect((await createClass(db, auditKey, plus2Coordinator.publicId, { yearId, levelId: plus2.levelId })).ok).toBe(true);
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId: bachelors.levelId })).ok).toBe(true);
  });

  it("refuses an unknown year or level, an inactive level, and a closed year", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId: "0".repeat(32), levelId })).toEqual({ ok: false, reason: "not_found" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId: "0".repeat(32) })).toEqual({ ok: false, reason: "not_found" });

    await updateLevel(db, auditKey, coordinator.publicId, levelId, { active: false });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toMatchObject({ ok: false, reason: "invalid" });
    await updateLevel(db, auditKey, coordinator.publicId, levelId, { active: true });

    const before = [await classes(), await audits()];
    await closeYear(yearId);
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "year_closed" });
    expect([await classes(), await audits()]).toEqual(before);
  });

  it("refuses every other role, and a switched-off Co-ordinator, and writes nothing", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await classes(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createClass(db, auditKey, who.publicId, { yearId, levelId }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await createClass(db, auditKey, off.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await classes(), await audits()]).toEqual(before);
  });

  it("refuses a label that is too long and a field that is not allowed", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "x".repeat(41) })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, programmeId: "x" } as never)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateClass", () => {
  const make = async (sectionKey: "plus2" | "bachelors" = "bachelors", label = "") => {
    const yearId = await newYear();
    const { levelId } = await newLevel(sectionKey);
    const r = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label });
    if (!r.ok) throw new Error("setup failed");
    return { id: r.publicId, yearId, levelId };
  };

  it("relabels and deactivates a class, and records both", async () => {
    const { id } = await make();
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Evening" })).toEqual({ ok: true });
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT label, is_active FROM classes WHERE public_id = ?1").bind(id).first()).toEqual({ label: "Evening", is_active: 0 });
    expect(await auditActions(id)).toEqual(["academics.class.created", "academics.class.updated", "academics.class.updated"]);
  });

  it("a label that another class of the level and year already has is a conflict", async () => {
    const { id, yearId, levelId } = await make();
    await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" });
    const before = await audits();
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Morning" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });

  it("a closed year cannot be changed, and another section's Co-ordinator cannot touch it", async () => {
    const { id, yearId } = await make("bachelors");
    expect(await updateClass(db, auditKey, plus2Coordinator.publicId, id, { label: "Nope" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateClass(db, auditKey, admin.publicId, id, { label: "Nope" })).toEqual({ ok: false, reason: "not_allowed" });
    await closeYear(yearId);
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Late" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await db.prepare("SELECT label FROM classes WHERE public_id = ?1").bind(id).first()).toEqual({ label: "" });
  });

  it("an unknown class is not found", async () => {
    expect(await updateClass(db, auditKey, coordinator.publicId, "0".repeat(32), { label: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("createTerminal", () => {
  it("numbers terminals 1, 2, 3 in the order they are added, including several at once", async () => {
    const yearId = await newYear();
    const results = await Promise.all(["First", "Second", "Third"].map((name) => createTerminal(db, auditKey, coordinator.publicId, { yearId, name })));
    expect(results.every((r) => r.ok)).toBe(true);
    const ordinals = (await db.prepare("SELECT t.ordinal FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.public_id = ?1 ORDER BY t.ordinal").bind(yearId).all<{ ordinal: number }>()).results.map((r) => r.ordinal);
    expect(ordinals).toEqual([1, 2, 3]);
  });

  it("records who did it", async () => {
    const yearId = await newYear();
    const r = await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "First terminal" });
    if (!r.ok) throw new Error("setup failed");
    expect(await auditActions(r.publicId)).toEqual(["academics.terminal.created"]);
  });

  it("belongs to the whole school: only an institution-wide Co-ordinator (or the Super Admin) may add one", async () => {
    const yearId = await newYear();
    const before = [await terminals(), await audits()];
    for (const [name, who] of [["+2 Co-ordinator", plus2Coordinator], ["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createTerminal(db, auditKey, who.publicId, { yearId, name: "First" }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await terminals(), await audits()]).toEqual(before);
  });

  it("refuses an unknown year, a closed year, an empty name, and a 13th terminal", async () => {
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId: "0".repeat(32), name: "First" })).toEqual({ ok: false, reason: "not_found" });

    const closed = await newYear();
    await closeYear(closed);
    const before = [await terminals(), await audits()];
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId: closed, name: "First" })).toEqual({ ok: false, reason: "year_closed" });
    expect([await terminals(), await audits()]).toEqual(before);

    const yearId = await newYear();
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: " " })).toMatchObject({ ok: false, reason: "invalid" });
    for (let n = 1; n <= 12; n++) expect((await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: `T${n}` })).ok).toBe(true);
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "T13" })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/at most 12/) });
  });
});

describe("updateTerminal", () => {
  it("renames a terminal; refuses the wrong person, a closed year, and an unknown id", async () => {
    const yearId = await newYear();
    const r = await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "First" });
    if (!r.ok) throw new Error("setup failed");

    expect(await updateTerminal(db, auditKey, coordinator.publicId, r.publicId, { name: "First terminal" })).toEqual({ ok: true });
    expect(await auditActions(r.publicId)).toEqual(["academics.terminal.created", "academics.terminal.updated"]);
    expect(await updateTerminal(db, auditKey, plus2Coordinator.publicId, r.publicId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateTerminal(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });

    await closeYear(yearId);
    expect(await updateTerminal(db, auditKey, coordinator.publicId, r.publicId, { name: "Late" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await db.prepare("SELECT name FROM terminals WHERE public_id = ?1").bind(r.publicId).first()).toEqual({ name: "First terminal" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-classes.test.ts`
Expected: FAIL: `createClass` is not exported.

- [ ] **Step 3: Append the schemas**

Append to the end of `apps/api/src/modules/academics/schema.ts`:

```ts

// --- Classes and terminals ---------------------------------------------------------------------------

const ClassLabel = z.string().trim().max(40, "Keep the label to 40 characters");
const TerminalName = z.string().trim().min(1, "Give the terminal a name").max(60, "Keep the name to 60 characters");

/** A class is a level in a year. The programme is the level's own, so it is never sent. */
export const CreateClassSchema = z.strictObject({ yearId: PublicIdSchema, levelId: PublicIdSchema, label: ClassLabel.default("") }).openapi("CreateClass");
export type ClassInput = z.input<typeof CreateClassSchema>;

export const ClassChangesSchema = z.strictObject({ label: ClassLabel, active: z.boolean() }).partial().openapi("ClassChanges");
export type ClassChanges = z.infer<typeof ClassChangesSchema>;

export const CreateTerminalSchema = z.strictObject({ yearId: PublicIdSchema, name: TerminalName }).openapi("CreateTerminal");
export type TerminalInput = z.input<typeof CreateTerminalSchema>;

export const TerminalChangesSchema = z.strictObject({ name: TerminalName }).partial().openapi("TerminalChanges");
export type TerminalChanges = z.infer<typeof TerminalChangesSchema>;
```

- [ ] **Step 4: Write the class and terminal service**

Create `apps/api/src/modules/academics/classes.ts`:

```ts
import { newPublicId } from "../../core/ids";
import { coordinatorForInstitution, coordinatorForSection } from "./guard";
import {
  ClassChangesSchema,
  CreateClassSchema,
  CreateTerminalSchema,
  TerminalChangesSchema,
  type ClassChanges,
  type ClassInput,
  type TerminalChanges,
  type TerminalInput,
} from "./schema";
import { firstMessage, write, type Created, type Done } from "./write";

// --- Classes -----------------------------------------------------------------------------------------

/** Why a new class was not made: one round trip to tell the person the truth. */
async function whyNoClass(db: D1Database, actor: string, yearId: string, levelId: string): Promise<Created> {
  const [allowed, year, level] = await db.batch([
    db
      .prepare(
        `SELECT ${coordinatorForSection(1, "(SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?2)")} AS ok`,
      )
      .bind(actor, levelId),
    db.prepare("SELECT status FROM academic_years WHERE public_id = ?1").bind(yearId),
    db
      .prepare("SELECT l.is_active AS level_active, p.is_active AS programme_active FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?1")
      .bind(levelId),
  ]);
  const yearRow = year!.results[0] as { status: string } | undefined;
  const levelRow = level!.results[0] as { level_active: number; programme_active: number } | undefined;

  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  if (!yearRow || !levelRow) return { ok: false, reason: "not_found" };
  if (yearRow.status === "closed") return { ok: false, reason: "year_closed" };
  if (levelRow.level_active === 0 || levelRow.programme_active === 0) return { ok: false, reason: "invalid", message: "That level or its programme is switched off" };
  return { ok: false, reason: "not_allowed" };
}

/** Makes a class: a level of a programme, in one year, with an optional label such as Morning. */
export async function createClass(db: D1Database, auditKey: string, actor: string, input: ClassInput): Promise<Created> {
  const parsed = CreateClassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.class.created",
      entityType: "class",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: c.label ? `Class added (${c.label})` : "Class added",
      after: c,
    },
    db
      .prepare(
        `INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label)
         SELECT ?1, y.id, l.programme_id, l.id, ?4
           FROM academic_years y
           CROSS JOIN levels l
           JOIN programmes p ON p.id = l.programme_id
          WHERE y.public_id = ?2 AND l.public_id = ?3
            AND y.status <> 'closed' AND l.is_active = 1 AND p.is_active = 1
            AND ${coordinatorForSection(5, "p.section_id")}`,
      )
      .bind(publicId, c.yearId, c.levelId, c.label, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  return whyNoClass(db, actor, c.yearId, c.levelId);
}

interface ClassRow {
  label: string;
  is_active: number;
  status: "draft" | "active" | "closed";
}

async function inspectClass(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db
      .prepare(
        `SELECT ${coordinatorForSection(1, "(SELECT p.section_id FROM classes c JOIN programmes p ON p.id = c.programme_id WHERE c.public_id = ?2)")} AS ok`,
      )
      .bind(actor, publicId),
    db.prepare("SELECT c.label, c.is_active, y.status FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    row: (row!.results[0] as unknown as ClassRow | undefined) ?? null,
  };
}

/** Relabels a class or switches it off and on. Nothing is deleted, and a closed year cannot be changed. */
export async function updateClass(db: D1Database, auditKey: string, actor: string, publicId: string, changes: ClassChanges): Promise<Done> {
  const parsed = ClassChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const { allowed, row } = await inspectClass(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "closed") return { ok: false, reason: "year_closed" };

  const before = { label: row.label, active: row.is_active === 1 };
  const after = { label: c.label ?? before.label, active: c.active ?? before.active };
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.class.updated",
      entityType: "class",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: "Class changed",
      before,
      after,
    },
    db
      .prepare(
        `UPDATE classes SET label = ?2, is_active = ?3
          WHERE public_id = ?1
            AND (SELECT status FROM academic_years WHERE id = classes.academic_year_id) <> 'closed'
            AND ${coordinatorForSection(4, "(SELECT section_id FROM programmes WHERE id = classes.programme_id)")}`,
      )
      .bind(publicId, after.label, after.active ? 1 : 0, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };

  const again = await inspectClass(db, publicId, actor);
  if (again.allowed && again.row?.status === "closed") return { ok: false, reason: "year_closed" };
  return { ok: false, reason: "not_allowed" };
}

// --- Terminals ---------------------------------------------------------------------------------------

/** Adds a terminal to a year, numbered after the last one. Two added at once get different numbers. */
export async function createTerminal(db: D1Database, auditKey: string, actor: string, input: TerminalInput): Promise<Created> {
  const parsed = CreateTerminalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const t = parsed.data;

  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.terminal.created",
      entityType: "terminal",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Terminal "${t.name}" added`,
      after: t,
    },
    db
      .prepare(
        `INSERT INTO terminals (public_id, academic_year_id, name, ordinal)
         SELECT ?1, y.id, ?3, COALESCE((SELECT MAX(ordinal) FROM terminals WHERE academic_year_id = y.id), 0) + 1
           FROM academic_years y
          WHERE y.public_id = ?2 AND y.status <> 'closed' AND ${coordinatorForInstitution(4)}`,
      )
      .bind(publicId, t.yearId, t.name, actor),
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "A year can have at most 12 terminals" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };

  const [allowed, year] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db.prepare("SELECT status FROM academic_years WHERE public_id = ?1").bind(t.yearId),
  ]);
  if ((allowed!.results[0] as { ok: number } | undefined)?.ok !== 1) return { ok: false, reason: "not_allowed" };
  const yearRow = year!.results[0] as { status: string } | undefined;
  if (!yearRow) return { ok: false, reason: "not_found" };
  return { ok: false, reason: yearRow.status === "closed" ? "year_closed" : "not_allowed" };
}

async function inspectTerminal(db: D1Database, publicId: string, actor: string) {
  const [allowed, row] = await db.batch([
    db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor),
    db.prepare("SELECT t.name, y.status FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE t.public_id = ?1").bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    row: (row!.results[0] as { name: string; status: string } | undefined) ?? null,
  };
}

/** Renames a terminal. A closed year cannot be changed. */
export async function updateTerminal(db: D1Database, auditKey: string, actor: string, publicId: string, changes: TerminalChanges): Promise<Done> {
  const parsed = TerminalChangesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  const { allowed, row } = await inspectTerminal(db, publicId, actor);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "closed") return { ok: false, reason: "year_closed" };

  const name = parsed.data.name ?? row.name;
  if (name === row.name) return { ok: true };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.terminal.updated",
      entityType: "terminal",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Terminal renamed to "${name}"`,
      before: { name: row.name },
      after: { name },
    },
    db
      .prepare(
        `UPDATE terminals SET name = ?2
          WHERE public_id = ?1
            AND (SELECT status FROM academic_years WHERE id = terminals.academic_year_id) <> 'closed'
            AND ${coordinatorForInstitution(3)}`,
      )
      .bind(publicId, name, actor),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  return { ok: false, reason: "not_allowed" };
}
```

- [ ] **Step 5: Export it**

In `apps/api/src/modules/academics/service.ts`, add after the `export * from "./programmes";` line:

```ts
export * from "./classes";
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-classes.test.ts`
Expected: PASS. (The test that closes a year and expects `year_closed` passes through the service's own `y.status <> 'closed'` guard; the trigger tests in Task 1 cover the case where that guard is missing.)

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/api && npx tsc --noEmit && npx eslint src/modules/academics test/academics-classes.test.ts`
Expected: no output.

```bash
git add apps/api/src/modules/academics apps/api/test/academics-classes.test.ts
git commit -m "Slice 1: classes and terminals; a closed year refuses every change" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: The reads, the routes, and the contract

**Files:**
- Modify: `apps/api/src/modules/academics/schema.ts` (append), `apps/api/src/app.ts`
- Create: `apps/api/src/modules/academics/queries.ts`, `routes.ts`, `index.ts`
- Test: `apps/api/test/academics-routes.test.ts`
- Regenerate: `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`

**Interfaces:**
- Consumes: every service function from Tasks 3 to 5; `allowedSections` from `core/permissions`.
- Produces (the API the web app is generated from):

| Route | Action | Success |
|---|---|---|
| `GET /api/academics/years` | `setup.structure.view` | `200 { years: AcademicYear[] }` |
| `GET /api/academics/programmes` | `setup.structure.view` | `200 { programmes: Programme[] }` (with levels; only the person's sections) |
| `GET /api/academics/classes?year=` | `setup.structure.view` | `200 { classes: SchoolClass[] }` |
| `GET /api/academics/terminals?year=` | `setup.structure.view` | `200 { terminals: Terminal[] }` |
| `POST /api/academics/years` | `setup.structure.manage` | `201 { id }` |
| `PATCH /api/academics/years/{id}` | `setup.structure.manage` | `200 { ok: true }` |
| `POST /api/academics/years/{id}/activate` | `setup.structure.manage` | `200 { ok: true }` |
| `POST /api/academics/programmes` | `setup.structure.manage` | `201 { id }` |
| `PATCH /api/academics/programmes/{id}` | `setup.structure.manage` | `200 { ok: true }` |
| `POST /api/academics/programmes/{id}/levels` | `setup.structure.manage` | `201 { id }` |
| `PATCH /api/academics/levels/{id}` | `setup.structure.manage` | `200 { ok: true }` |
| `POST /api/academics/classes` | `setup.structure.manage` | `201 { id }` |
| `PATCH /api/academics/classes/{id}` | `setup.structure.manage` | `200 { ok: true }` |
| `POST /api/academics/terminals` | `setup.structure.manage` | `201 { id }` |
| `PATCH /api/academics/terminals/{id}` | `setup.structure.manage` | `200 { ok: true }` |

Errors: `403 { error: "forbidden" }`, `404 { error: "not_found" }`, `409 { error: "conflict" | "year_closed" | "not_draft" | "another_active" }`, `422 { error: "invalid", message }`; a body that breaks the request schema is `400`.

- [ ] **Step 1: Write the failing route tests**

Create `apps/api/test/academics-routes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { auditActions, auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

let bs = 2010;
const yearBody = () => {
  const bsYear = ++bs;
  return { bsYear, startDate: bsToAd({ year: bsYear, month: 1, day: 1 }), endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }) };
};

const post = (path: string, body: unknown, who: Person) => call(`/api/academics${path}`, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(`/api/academics${path}`, { method: "PATCH", body, cookie: who.cookie });
const get = (path: string, who: Person) => call(`/api/academics${path}`, { cookie: who.cookie });
const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;

async function makeYear(who: Person = coordinator) {
  const response = await post("/years", yearBody(), who);
  expect(response.status).toBe(201);
  return idOf(response);
}
async function makeProgramme(sectionKey: "plus2" | "bachelors", who: Person = coordinator) {
  const response = await post("/programmes", { name: `${sectionKey} programme`, sectionKey, affiliation: "Board" }, who);
  expect(response.status).toBe(201);
  const programmeId = await idOf(response);
  const level = await post(`/programmes/${programmeId}/levels`, { name: "Level 1" }, who);
  expect(level.status).toBe(201);
  return { programmeId, levelId: await idOf(level) };
}

const noId = "0".repeat(32);
const reads = ["/years", "/programmes", "/classes", "/terminals"];
const writes: [string, string, unknown][] = [
  ["POST", "/years", yearBody()],
  ["PATCH", `/years/${noId}`, { label: "x" }],
  ["POST", `/years/${noId}/activate`, undefined],
  ["POST", "/programmes", { name: "x", sectionKey: "plus2", affiliation: "y" }],
  ["PATCH", `/programmes/${noId}`, { name: "x" }],
  ["POST", `/programmes/${noId}/levels`, { name: "x" }],
  ["PATCH", `/levels/${noId}`, { name: "x" }],
  ["POST", "/classes", { yearId: noId, levelId: noId }],
  ["PATCH", `/classes/${noId}`, { label: "x" }],
  ["POST", "/terminals", { yearId: noId, name: "x" }],
  ["PATCH", `/terminals/${noId}`, { name: "x" }],
];

// ---------------------------------------------------------------------------------------------
describe("who may use the academic routes", () => {
  it("nobody who is signed out: 401 everywhere, and a garbage body is not even looked at", async () => {
    for (const path of reads) expect((await call(`/api/academics${path}`)).status, path).toBe(401);
    for (const [method, path, body] of writes) expect((await call(`/api/academics${path}`, { method, body })).status, `${method} ${path}`).toBe(401);
    expect((await call("/api/academics/programmes", { method: "POST", body: { nonsense: true } })).status).toBe(401);
  });

  it("students, teachers and accountants: 403 everywhere, and nothing is written", async () => {
    const before = await count("SELECT (SELECT COUNT(*) FROM academic_years) + (SELECT COUNT(*) FROM programmes) AS n");
    for (const who of [student, teacher, accountant]) {
      for (const path of reads) expect((await get(path, who)).status, path).toBe(403);
      for (const [method, path, body] of writes) expect((await call(`/api/academics${path}`, { method, body, cookie: who.cookie })).status, `${method} ${path}`).toBe(403);
    }
    expect(await count("SELECT (SELECT COUNT(*) FROM academic_years) + (SELECT COUNT(*) FROM programmes) AS n")).toBe(before);
  });

  it("the Admin may look but not change anything", async () => {
    for (const path of reads) expect((await get(path, admin)).status, path).toBe(200);
    for (const [method, path, body] of writes) expect((await call(`/api/academics${path}`, { method, body, cookie: admin.cookie })).status, `${method} ${path}`).toBe(403);
  });

  it("the Co-ordinator and the Super Admin may look and change", async () => {
    for (const who of [coordinator, superAdmin]) {
      for (const path of reads) expect((await get(path, who)).status, path).toBe(200);
      expect((await post("/years", yearBody(), who)).status).toBe(201);
    }
  });

  it("a section-scoped Co-ordinator may look at years and terminals but not add them", async () => {
    expect((await get("/years", plus2Coordinator)).status).toBe(200);
    expect((await get("/terminals", plus2Coordinator)).status).toBe(200);
    expect((await post("/years", yearBody(), plus2Coordinator)).status).toBe(403);
    expect((await post("/terminals", { yearId: noId, name: "First" }, plus2Coordinator)).status).toBe(403);
  });

  it("a switched-off Co-ordinator with a valid sign-in is refused (403), not served from the token", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = await count("SELECT COUNT(*) AS n FROM academic_years");
    expect((await post("/years", yearBody(), off)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM academic_years")).toBe(before);
  });

  it("answers are never cached", async () => {
    expect((await get("/programmes", coordinator)).headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------------------------
describe("setting up a year, end to end", () => {
  it("year, programme, level, class, terminal: created, listed, changed, and audited", async () => {
    const yearId = await makeYear();
    const { programmeId, levelId } = await makeProgramme("bachelors");

    const activate = await post(`/years/${yearId}/activate`, undefined, coordinator);
    expect(activate.status).toBe(200);

    const classResponse = await post("/classes", { yearId, levelId, label: "Morning" }, coordinator);
    expect(classResponse.status).toBe(201);
    const classId = await idOf(classResponse);
    const terminalResponse = await post("/terminals", { yearId, name: "First terminal" }, coordinator);
    expect(terminalResponse.status).toBe(201);
    const terminalId = await idOf(terminalResponse);

    const years = (await (await get("/years", coordinator)).json()) as { years: { id: string; status: string; startDate: string; startDateBs: string | null }[] };
    const year = years.years.find((y) => y.id === yearId)!;
    expect(year.status).toBe("active");
    expect(year.startDateBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const programmes = (await (await get("/programmes", coordinator)).json()) as { programmes: { id: string; section: { key: string }; levels: { id: string; ordinal: number; name: string; active: boolean }[] }[] };
    const programme = programmes.programmes.find((p) => p.id === programmeId)!;
    expect(programme.section.key).toBe("bachelors");
    expect(programme.levels).toEqual([{ id: levelId, ordinal: 1, name: "Level 1", active: true }]);

    const classes = (await (await get(`/classes?year=${yearId}`, coordinator)).json()) as { classes: { id: string; label: string; levelName: string; programmeName: string; active: boolean }[] };
    expect(classes.classes).toMatchObject([{ id: classId, label: "Morning", levelName: "Level 1", active: true }]);
    const terminals = (await (await get(`/terminals?year=${yearId}`, coordinator)).json()) as { terminals: { id: string; name: string; ordinal: number }[] };
    expect(terminals.terminals).toMatchObject([{ id: terminalId, name: "First terminal", ordinal: 1 }]);

    expect((await patch(`/classes/${classId}`, { active: false }, coordinator)).status).toBe(200);
    expect((await patch(`/levels/${levelId}`, { name: "Year 1" }, coordinator)).status).toBe(200);
    expect((await patch(`/programmes/${programmeId}`, { name: "Renamed" }, coordinator)).status).toBe(200);
    expect((await patch(`/terminals/${terminalId}`, { name: "Mid-year" }, coordinator)).status).toBe(200);

    expect(await auditActions(classId)).toEqual(["academics.class.created", "academics.class.updated"]);
    const actor = await db.prepare("SELECT u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1 LIMIT 1").bind(classId).first<{ actor: string }>();
    expect(actor!.actor).toBe(coordinator.publicId);
  });

  it("status codes for the failure cases: 400 for a bad shape, 422 for a broken rule, 404, and 409", async () => {
    // A body that breaks the request schema.
    expect((await post("/programmes", { name: "x" }, coordinator)).status).toBe(400);
    expect((await post("/years", { ...yearBody(), status: "active" }, coordinator)).status).toBe(400);
    // A rule the service checks (a BS year whose calendar is not verified).
    const unverified = await post("/years", { bsYear: 2090, startDate: "2033-04-14", endDate: "2034-04-13" }, coordinator);
    expect(unverified.status).toBe(422);
    expect(await unverified.json()).toMatchObject({ error: "invalid" });
    // Not found.
    expect((await post(`/programmes/${noId}/levels`, { name: "x" }, coordinator)).status).toBe(404);
    expect((await patch(`/classes/${noId}`, { label: "x" }, coordinator)).status).toBe(404);
    // A repeat class is a conflict; a closed year is a conflict with its own word.
    const yearId = await makeYear();
    const { levelId } = await makeProgramme("plus2");
    expect((await post("/classes", { yearId, levelId }, coordinator)).status).toBe(201);
    const duplicate = await post("/classes", { yearId, levelId }, coordinator);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "conflict" });
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(yearId).run();
    const closed = await post("/classes", { yearId, levelId, label: "Late" }, coordinator);
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "year_closed" });
    expect((await post("/terminals", { yearId, name: "Late" }, coordinator)).status).toBe(409);
  });

  it("a year cannot be activated while another is active (the test above activated one, and tests run in order)", async () => {
    const another = await makeYear();
    const response = await post(`/years/${another}/activate`, undefined, coordinator);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "another_active" });
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE status = 'active'")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("a section-scoped Co-ordinator gets nothing from the other section (data-level)", () => {
  it("lists only their own section's programmes and classes", async () => {
    const plus2 = await makeProgramme("plus2");
    const bachelors = await makeProgramme("bachelors");
    const yearId = await makeYear();
    await post("/classes", { yearId, levelId: plus2.levelId }, coordinator);
    await post("/classes", { yearId, levelId: bachelors.levelId }, coordinator);

    const seen = async (who: Person) => {
      const programmes = (await (await get("/programmes", who)).json()) as { programmes: { id: string }[] };
      const classes = (await (await get(`/classes?year=${yearId}`, who)).json()) as { classes: { programmeId: string }[] };
      return { programmes: programmes.programmes.map((p) => p.id), classes: classes.classes.map((c) => c.programmeId) };
    };

    const mine = await seen(plus2Coordinator);
    expect(mine.programmes).toContain(plus2.programmeId);
    expect(mine.programmes).not.toContain(bachelors.programmeId);
    expect(mine.classes).toEqual([plus2.programmeId]);

    const theirs = await seen(bachelorsCoordinator);
    expect(theirs.programmes).toContain(bachelors.programmeId);
    expect(theirs.programmes).not.toContain(plus2.programmeId);
    expect(theirs.classes).toEqual([bachelors.programmeId]);

    const all = await seen(coordinator);
    expect(all.programmes).toEqual(expect.arrayContaining([plus2.programmeId, bachelors.programmeId]));
    expect((await seen(admin)).programmes).toEqual(expect.arrayContaining([plus2.programmeId, bachelors.programmeId]));
  });

  it("cannot change the other section's programme, level or classes, even with the right ids", async () => {
    const bachelors = await makeProgramme("bachelors");
    const yearId = await makeYear();
    const classId = await idOf(await post("/classes", { yearId, levelId: bachelors.levelId }, coordinator));

    expect((await patch(`/programmes/${bachelors.programmeId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await post(`/programmes/${bachelors.programmeId}/levels`, { name: "Year 2" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/levels/${bachelors.levelId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await post("/classes", { yearId, levelId: bachelors.levelId, label: "Evening" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/classes/${classId}`, { active: false }, plus2Coordinator)).status).toBe(403);
    expect((await post("/programmes", { name: "Sneaky", sectionKey: "bachelors", affiliation: "TU" }, plus2Coordinator)).status).toBe(403);

    expect(await db.prepare("SELECT name FROM programmes WHERE public_id = ?1").bind(bachelors.programmeId).first()).toEqual({ name: "bachelors programme" });
    expect(await db.prepare("SELECT is_active FROM classes WHERE public_id = ?1").bind(classId).first()).toEqual({ is_active: 1 });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-routes.test.ts`
Expected: FAIL: the routes return 404 (not mounted).

- [ ] **Step 3: Append the response schemas**

Append to the end of `apps/api/src/modules/academics/schema.ts`:

```ts

// --- What the screens read ---------------------------------------------------------------------------

export const AcademicYearSchema = z
  .object({
    id: z.string(),
    bsYear: z.number().int(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD"; null if a day is outside the verified years. */
    startDateBs: z.string().nullable(),
    endDateBs: z.string().nullable(),
    status: z.enum(["draft", "active", "closed"]),
  })
  .openapi("AcademicYear");
export const AcademicYearListSchema = z.object({ years: z.array(AcademicYearSchema) }).openapi("AcademicYearList");
export type AcademicYearList = z.infer<typeof AcademicYearListSchema>;

export const LevelSchema = z.object({ id: z.string(), ordinal: z.number().int(), name: z.string(), active: z.boolean() }).openapi("Level");
export const ProgrammeSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    section: z.object({ key: z.string(), name: z.string() }),
    affiliation: z.string(),
    active: z.boolean(),
    levels: z.array(LevelSchema),
  })
  .openapi("Programme");
export const ProgrammeListSchema = z.object({ programmes: z.array(ProgrammeSchema) }).openapi("ProgrammeList");
export type ProgrammeList = z.infer<typeof ProgrammeListSchema>;

export const SchoolClassSchema = z
  .object({
    id: z.string(),
    yearId: z.string(),
    programmeId: z.string(),
    programmeName: z.string(),
    sectionKey: z.string(),
    levelId: z.string(),
    levelName: z.string(),
    /** Empty when the class has no label. */
    label: z.string(),
    active: z.boolean(),
  })
  .openapi("SchoolClass");
export const SchoolClassListSchema = z.object({ classes: z.array(SchoolClassSchema) }).openapi("SchoolClassList");
export type SchoolClassList = z.infer<typeof SchoolClassListSchema>;

export const TerminalSchema = z.object({ id: z.string(), yearId: z.string(), name: z.string(), ordinal: z.number().int() }).openapi("Terminal");
export const TerminalListSchema = z.object({ terminals: z.array(TerminalSchema) }).openapi("TerminalList");
export type TerminalList = z.infer<typeof TerminalListSchema>;
```

- [ ] **Step 4: Write the reads**

Create `apps/api/src/modules/academics/queries.ts`:

```ts
import { adToBsText } from "../../core/dates";
import type { AcademicYearList, ProgrammeList, SchoolClassList, TerminalList } from "./schema";

/** A section filter for SQL: `null` means every section, otherwise a JSON array of section keys (used with `json_each`). */
const sectionFilter = (sections: "all" | readonly string[]): string | null => (sections === "all" ? null : JSON.stringify(sections));

interface YearRow {
  public_id: string;
  bs_year: number;
  label: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
}

/** Every year, newest first. One database round trip. */
export async function listYears(db: D1Database): Promise<AcademicYearList> {
  const { results } = await db
    .prepare("SELECT public_id, bs_year, label, start_date, end_date, status FROM academic_years ORDER BY bs_year DESC")
    .all<YearRow>();
  return {
    years: results.map((y) => ({
      id: y.public_id,
      bsYear: y.bs_year,
      label: y.label,
      startDate: y.start_date,
      endDate: y.end_date,
      startDateBs: adToBsText(y.start_date),
      endDateBs: adToBsText(y.end_date),
      status: y.status,
    })),
  };
}

interface ProgrammeRow {
  public_id: string;
  key: string;
  name: string;
  affiliation: string;
  is_active: number;
  section_key: string;
  section_name: string;
  level_id: string | null;
  ordinal: number | null;
  level_name: string | null;
  level_active: number | null;
}

/** The programmes of these sections, each with its levels in order. One database round trip. */
export async function listProgrammes(db: D1Database, sections: "all" | readonly string[]): Promise<ProgrammeList> {
  const { results } = await db
    .prepare(
      `SELECT p.public_id, p.key, p.name, p.affiliation, p.is_active, s.key AS section_key, s.name AS section_name,
              l.public_id AS level_id, l.ordinal, l.name AS level_name, l.is_active AS level_active
         FROM programmes p
         JOIN sections s ON s.id = p.section_id
         LEFT JOIN levels l ON l.programme_id = p.id
        WHERE (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
        ORDER BY p.ordering, p.id, l.ordinal`,
    )
    .bind(sectionFilter(sections))
    .all<ProgrammeRow>();

  const programmes: ProgrammeList["programmes"] = [];
  for (const r of results) {
    let programme = programmes[programmes.length - 1];
    if (!programme || programme.id !== r.public_id) {
      programme = { id: r.public_id, key: r.key, name: r.name, section: { key: r.section_key, name: r.section_name }, affiliation: r.affiliation, active: r.is_active === 1, levels: [] };
      programmes.push(programme);
    }
    if (r.level_id !== null) programme.levels.push({ id: r.level_id, ordinal: r.ordinal!, name: r.level_name!, active: r.level_active === 1 });
  }
  return { programmes };
}

interface ClassRow {
  public_id: string;
  year_id: string;
  programme_id: string;
  programme_name: string;
  section_key: string;
  level_id: string;
  level_name: string;
  label: string;
  is_active: number;
}

/** The classes of these sections, optionally of one year. One database round trip. */
export async function listClasses(db: D1Database, sections: "all" | readonly string[], yearId?: string): Promise<SchoolClassList> {
  const { results } = await db
    .prepare(
      `SELECT c.public_id, y.public_id AS year_id, p.public_id AS programme_id, p.name AS programme_name, s.key AS section_key,
              l.public_id AS level_id, l.name AS level_name, c.label, c.is_active
         FROM classes c
         JOIN academic_years y ON y.id = c.academic_year_id
         JOIN programmes p ON p.id = c.programme_id
         JOIN levels l ON l.id = c.level_id
         JOIN sections s ON s.id = p.section_id
        WHERE (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
          AND (?2 IS NULL OR y.public_id = ?2)
        ORDER BY y.bs_year DESC, p.ordering, l.ordinal, c.label`,
    )
    .bind(sectionFilter(sections), yearId ?? null)
    .all<ClassRow>();
  return {
    classes: results.map((c) => ({
      id: c.public_id,
      yearId: c.year_id,
      programmeId: c.programme_id,
      programmeName: c.programme_name,
      sectionKey: c.section_key,
      levelId: c.level_id,
      levelName: c.level_name,
      label: c.label,
      active: c.is_active === 1,
    })),
  };
}

interface TerminalRow {
  public_id: string;
  year_id: string;
  name: string;
  ordinal: number;
}

/** The terminals of one year, or of every year. They belong to the whole school, so no section filter. */
export async function listTerminals(db: D1Database, yearId?: string): Promise<TerminalList> {
  const { results } = await db
    .prepare(
      `SELECT t.public_id, y.public_id AS year_id, t.name, t.ordinal
         FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id
        WHERE (?1 IS NULL OR y.public_id = ?1)
        ORDER BY y.bs_year DESC, t.ordinal`,
    )
    .bind(yearId ?? null)
    .all<TerminalRow>();
  return { terminals: results.map((t) => ({ id: t.public_id, yearId: t.year_id, name: t.name, ordinal: t.ordinal })) };
}
```

- [ ] **Step 5: Write the routes**

Create `apps/api/src/modules/academics/routes.ts`:

```ts
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { listClasses, listProgrammes, listTerminals, listYears } from "./queries";
import {
  AcademicYearListSchema,
  ClassChangesSchema,
  CreateClassSchema,
  CreateLevelSchema,
  CreateProgrammeSchema,
  CreateTerminalSchema,
  CreateYearSchema,
  LevelChangesSchema,
  ProgrammeChangesSchema,
  ProgrammeListSchema,
  PublicIdSchema,
  SchoolClassListSchema,
  TerminalChangesSchema,
  TerminalListSchema,
  YearChangesSchema,
} from "./schema";
import {
  activateYear,
  addLevel,
  createClass,
  createProgramme,
  createTerminal,
  createYear,
  updateClass,
  updateLevel,
  updateProgramme,
  updateTerminal,
  updateYear,
  type Failure,
} from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("AcademicsError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("AcademicsInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("AcademicsOk");
const CreatedSchema = z.object({ id: z.string() }).openapi("AcademicsCreated");
const IdParam = z.object({ id: PublicIdSchema });
const YearQuery = z.object({ year: PublicIdSchema.optional() });

/** The failure answers every write route documents. */
const failures = {
  403: { description: "Not allowed (for example, switched off since signing in, or another section's data)", content: json(ErrorSchema) },
  404: { description: "No such item", content: json(ErrorSchema) },
  409: { description: "It conflicts with what is already there (a repeat, a closed year, another active year)", content: json(ErrorSchema) },
  422: { description: "The change breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/**
 * Turns a service refusal into the documented answer. The cast to `never` is because the handler's type is the
 * union of what each route declares, which this one function serves for all of them.
 */
function fail(c: Context<AppEnv>, failure: Failure): never {
  switch (failure.reason) {
    case "invalid":
      return c.json({ error: "invalid" as const, message: failure.message }, 422) as never;
    case "not_allowed":
      return c.json({ error: "forbidden" }, 403) as never;
    case "not_found":
      return c.json({ error: "not_found" }, 404) as never;
    default:
      return c.json({ error: failure.reason }, 409) as never;
  }
}

const VIEW = { action: "setup.structure.view" } as const;
const MANAGE = { action: "setup.structure.manage" } as const;

export function registerAcademics(app: App): void {
  // --- Reads ---------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/years",
      operationId: "list_academic_years",
      tags: ["academics"],
      description: "Every academic year, newest first, with its days in both calendars.",
      access: VIEW,
      responses: { 200: { description: "The years", content: json(AcademicYearListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listYears(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/programmes",
      operationId: "list_programmes",
      tags: ["academics"],
      description: "The programmes of the sections the person may see, each with its levels in order.",
      access: VIEW,
      responses: { 200: { description: "The programmes", content: json(ProgrammeListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listProgrammes(c.env.DB, allowedSections(c.get("grant")!)), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/classes",
      operationId: "list_classes",
      tags: ["academics"],
      description: "The classes of the sections the person may see, optionally of one year.",
      access: VIEW,
      request: { query: YearQuery },
      responses: { 200: { description: "The classes", content: json(SchoolClassListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listClasses(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("query").year), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/terminals",
      operationId: "list_terminals",
      tags: ["academics"],
      description: "The terminals of one year, or of every year.",
      access: VIEW,
      request: { query: YearQuery },
      responses: { 200: { description: "The terminals", content: json(TerminalListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listTerminals(c.env.DB, c.req.valid("query").year), 200);
    },
  );

  // --- Years -----------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/years",
      operationId: "create_academic_year",
      tags: ["academics"],
      description: "Adds a year as a draft. Days are AD; the BS year must be one whose calendar is verified.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateYearSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/years/{id}",
      operationId: "update_academic_year",
      tags: ["academics"],
      description: "Changes a draft year's label or days. Send only what changes.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(YearChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/years/{id}/activate",
      operationId: "activate_academic_year",
      tags: ["academics"],
      description: "Makes a draft year the active one. Refused (409) while another year is active.",
      access: MANAGE,
      request: { params: IdParam },
      responses: { 200: { description: "Now active", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await activateYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Programmes and levels ---------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/programmes",
      operationId: "create_programme",
      tags: ["academics"],
      description: "Adds a programme to a section the person may manage.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateProgrammeSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createProgramme(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/programmes/{id}",
      operationId: "update_programme",
      tags: ["academics"],
      description: "Renames a programme, changes its affiliation, or switches it off and on. Nothing is deleted.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(ProgrammeChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateProgramme(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/programmes/{id}/levels",
      operationId: "add_level",
      tags: ["academics"],
      description: "Adds a level (Grade 11, Year 1) to a programme, numbered after the last one.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(CreateLevelSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await addLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/levels/{id}",
      operationId: "update_level",
      tags: ["academics"],
      description: "Renames a level or switches it off and on. Nothing is deleted.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(LevelChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Classes -----------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/classes",
      operationId: "create_class",
      tags: ["academics"],
      description: "Makes a class: a level in a year, with an optional label such as Morning. A repeat is 409; a closed year is 409 `year_closed`.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateClassSchema) } },
      responses: { 201: { description: "Made", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createClass(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/classes/{id}",
      operationId: "update_class",
      tags: ["academics"],
      description: "Relabels a class or switches it off and on. A closed year cannot be changed.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(ClassChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateClass(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Terminals ---------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/terminals",
      operationId: "create_terminal",
      tags: ["academics"],
      description: "Adds a terminal to a year, numbered after the last one.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateTerminalSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createTerminal(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/terminals/{id}",
      operationId: "update_terminal",
      tags: ["academics"],
      description: "Renames a terminal. A closed year cannot be changed.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(TerminalChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateTerminal(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}
```

If `npx tsc --noEmit` rejects `c.json({ id: result.publicId }, 201) : fail(c, result)` (the union return type), keep `fail` but change each handler to `if (!result.ok) return fail(c, result); return c.json(...)`. Do not loosen the schemas.

- [ ] **Step 6: Write the module index and mount the routes**

Create `apps/api/src/modules/academics/index.ts`:

```ts
/** What other modules may use from `academics` (the layer check allows only an index or a service). */
export { listClasses, listProgrammes, listTerminals, listYears } from "./queries";
export type { AcademicYearList, ProgrammeList, SchoolClassList, TerminalList } from "./schema";
```

In `apps/api/src/app.ts`, add the import after the `registerAccounts` import line:

```ts
import { registerAcademics } from "./modules/academics/routes";
```

and add the call after `registerAccounts(app);`:

```ts
  registerAcademics(app);
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the whole suite, the type checks, and the boundary and contract checks**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: all PASS, no output from tsc and eslint. `openapi.test.ts` and `permission-routes.test.ts` may fail because `openapi.json` is stale: that is the next step. Any other failure is a real problem: fix the cause.

Run: `cd apps/api && npm run gen:openapi && npx vitest run test/openapi.test.ts test/permission-routes.test.ts`
Expected: PASS. `git diff --stat openapi.json` shows the new routes and schemas.

Run: `cd ../.. && node scripts/check-boundaries.mjs`
Expected: prints no problems and exits 0.

- [ ] **Step 9: Regenerate the web client types**

Run: `cd apps/web && npm run gen:api && git diff --stat src/api/schema.d.ts`
Expected: `schema.d.ts` gains the `/api/academics/...` paths and the `AcademicYear`, `Programme`, `SchoolClass`, `Terminal` schemas.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/api/test/academics-routes.test.ts apps/api/openapi.json apps/web/src/api/schema.d.ts
git commit -m "Slice 1: the academic routes, reads scoped to the person's sections, and the contract" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: The pack seeds programmes and levels, only where missing

**Files:**
- Modify: `apps/api/src/core/config/pack.ts`, `packs/royal-softech/pack.json`, `packs/sample-basic-school/pack.json`
- Test: `apps/api/test/academics-pack.test.ts`

**Interfaces:**
- Consumes: tables `programmes`, `levels` (Task 1); `newPublicId` from `core/ids`.
- Produces: an optional pack block `academics: { programmes: { key: string; levels: string[] }[] }` (default `{ programmes: [] }`). `key` must be a key in `site.programmes`; the programme's name, section and affiliation come from that site entry.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/academics-pack.test.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately poke at loosely-typed and malformed data */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { InvalidPackError, applyPack, packOperations, parsePack, renderSql } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const clone = <T>(x: T): T => structuredClone(x);
const count = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
const levelsOf = async (db: D1Database, key: string) =>
  (await db.prepare("SELECT l.ordinal, l.name, l.is_active FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.key = ?1 ORDER BY l.ordinal").bind(key).all()).results;

describe("the academics block of a pack", () => {
  it("both real packs carry one, and every key is one of the site's programmes", () => {
    for (const json of [royalJson, sampleJson]) {
      const pack = parsePack(json);
      expect(pack.academics.programmes.length).toBeGreaterThan(0);
      const siteKeys = pack.site.programmes.map((p) => p.key);
      for (const programme of pack.academics.programmes) expect(siteKeys).toContain(programme.key);
    }
  });

  it("is optional: a pack without one is valid and seeds nothing", () => {
    const bare = clone(royalJson) as any;
    delete bare.academics;
    expect(parsePack(bare).academics).toEqual({ programmes: [] });
  });

  const cases: [string, (p: any) => void, RegExp][] = [
    ["a key that is not one of the site's programmes", (p) => (p.academics.programmes[0].key = "nowhere"), /academics\.programmes\.0\.key/],
    ["the same programme twice", (p) => p.academics.programmes.push(clone(p.academics.programmes[0])), /keys must be unique/],
    ["the same level name twice in a programme", (p) => (p.academics.programmes[0].levels = ["Year 1", "Year 1"]), /names must be unique/],
    ["a programme with no levels", (p) => (p.academics.programmes[0].levels = []), /levels/],
    ["more than 20 levels", (p) => (p.academics.programmes[0].levels = Array.from({ length: 21 }, (_, i) => `L${i}`)), /levels/],
    ["a field that is not allowed", (p) => (p.academics.programmes[0].name = "Mine"), /name|unrecognized/i],
  ];
  it.each(cases)("refuses %s", (_label, mutate, message) => {
    const bad = clone(royalJson) as any;
    mutate(bad);
    expect(() => parsePack(bad)).toThrow(InvalidPackError);
    try {
      parsePack(bad);
    } catch (error) {
      expect((error as InvalidPackError).problems.join("\n")).toMatch(message);
    }
  });
});

describe("applying a pack seeds programmes and levels", () => {
  it("takes each programme's name, section and affiliation from the site block, and its levels in order", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    for (const entry of pack.academics.programmes) {
      const site = pack.site.programmes.find((p) => p.key === entry.key)!;
      const row = await env.DB
        .prepare("SELECT p.name, p.affiliation, p.is_active, s.key AS section FROM programmes p JOIN sections s ON s.id = p.section_id WHERE p.key = ?1")
        .bind(entry.key)
        .first();
      expect(row).toEqual({ name: site.name, affiliation: site.affiliation, is_active: 1, section: site.section });
      expect((await levelsOf(env.DB, entry.key)).map((l: any) => [l.ordinal, l.name])).toEqual(entry.levels.map((name, i) => [i + 1, name]));
    }
  });

  it("applying twice changes nothing (same rows, same ids)", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    const snapshot = async () => (await env.DB.prepare("SELECT public_id, key, name, ordering FROM programmes ORDER BY id").all()).results;
    const levelsSnapshot = async () => (await env.DB.prepare("SELECT public_id, programme_id, ordinal, name FROM levels ORDER BY id").all()).results;
    const [programmes, levels] = [await snapshot(), await levelsSnapshot()];
    await applyPack(env.DB, pack);
    expect(await snapshot()).toEqual(programmes);
    expect(await levelsSnapshot()).toEqual(levels);
  });

  it("never overwrites what the Co-ordinator changed on a screen", async () => {
    const pack = parsePack(royalJson);
    const first = pack.academics.programmes[0]!;
    await applyPack(env.DB, pack);
    await env.DB.prepare("UPDATE programmes SET name = 'Renamed by the Co-ordinator', is_active = 0 WHERE key = ?1").bind(first.key).run();
    await env.DB.prepare("UPDATE levels SET name = 'First year (renamed)', is_active = 0 WHERE programme_id = (SELECT id FROM programmes WHERE key = ?1) AND ordinal = 1").bind(first.key).run();
    await env.DB
      .prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) SELECT 'added-by-hand', id, ?2, 'Added level' FROM programmes WHERE key = ?1")
      .bind(first.key, first.levels.length + 1)
      .run();

    await applyPack(env.DB, pack);

    expect(await env.DB.prepare("SELECT name, is_active FROM programmes WHERE key = ?1").bind(first.key).first()).toEqual({ name: "Renamed by the Co-ordinator", is_active: 0 });
    const levels = (await levelsOf(env.DB, first.key)) as any[];
    expect(levels[0]).toMatchObject({ name: "First year (renamed)", is_active: 0 });
    expect(levels.at(-1)).toMatchObject({ name: "Added level" });
    expect(levels).toHaveLength(first.levels.length + 1);
  });

  it("the sample school gets its own structure and none of Royal's", async () => {
    const pack = parsePack(sampleJson);
    await applyPack(env.SCRATCH_DB, pack);
    const keys = (await env.SCRATCH_DB.prepare("SELECT key FROM programmes ORDER BY ordering").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(pack.academics.programmes.map((p) => p.key));
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM programmes WHERE key LIKE 'plus2%' OR key LIKE 'bachelors%'")).toBe(0);
    expect((await levelsOf(env.SCRATCH_DB, "primary")).map((l: any) => l.name)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"]);
  });

  it("renders as plain SQL for the provisioning script, without leaving a value out", () => {
    const sql = renderSql(packOperations(parsePack(royalJson)));
    expect(sql).toContain("INSERT INTO programmes");
    expect(sql).toContain("INSERT INTO levels");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/academics-pack.test.ts`
Expected: FAIL: `pack.academics` is undefined.

- [ ] **Step 3: Extend the pack schema, its checks, and its operations**

In `apps/api/src/core/config/pack.ts`:

1. Add the import after the existing `import { isKnownTerm } from "./terminology";` line:

```ts
import { newPublicId } from "../ids";
```

2. In `PackSchema`, add this property directly after the `sections: ...` property (before the `/** Optional modules ... */` comment):

```ts
  /**
   * The levels of each programme (D-056). Each entry names a programme by its key in `site.programmes`, which
   * gives its name, section and affiliation. Seeded only where missing: a screen edit is never overwritten.
   */
  academics: z
    .strictObject({
      programmes: z
        .array(z.strictObject({ key: z.string().min(1).max(60), levels: z.array(z.string().trim().min(1).max(60)).min(1).max(20) }))
        .max(20),
    })
    .default({ programmes: [] }),
```

3. In `parsePack`, directly after the `pack.site.programmes.forEach(...)` block (the one that checks each programme's section), add:

```ts

  const academicKeys = pack.academics.programmes.map((p) => p.key);
  if (new Set(academicKeys).size !== academicKeys.length) problems.push("academics.programmes: keys must be unique");
  pack.academics.programmes.forEach((programme, index) => {
    if (!programmeKeys.includes(programme.key)) problems.push(`academics.programmes.${index}.key: "${programme.key}" is not one of site.programmes`);
    if (new Set(programme.levels).size !== programme.levels.length) problems.push(`academics.programmes.${index}.levels: names must be unique`);
  });
```

4. In `packOperations`, directly after the `pack.sections.forEach(...)` call (which ends with `);`), add:

```ts

  // Programmes and levels: added only where missing, never updated, so a Co-ordinator's edits on a screen survive
  // a re-applied pack (D-056). Sections were added just above, so the programme can find its section.
  pack.academics.programmes.forEach((entry, index) => {
    const site = pack.site.programmes.find((p) => p.key === entry.key)!; // `parsePack` guarantees it exists
    ops.push({
      sql: `INSERT INTO programmes (public_id, key, name, section_id, affiliation, ordering)
            SELECT ?, ?, ?, s.id, ?, ? FROM sections s WHERE s.key = ?
            ON CONFLICT (key) DO NOTHING`,
      params: [newPublicId(), entry.key, site.name, site.affiliation, index + 1, site.section],
    });
    entry.levels.forEach((name, position) =>
      ops.push({
        sql: `INSERT INTO levels (public_id, programme_id, ordinal, name)
              SELECT ?, p.id, ?, ? FROM programmes p WHERE p.key = ?
              ON CONFLICT (programme_id, ordinal) DO NOTHING`,
        params: [newPublicId(), position + 1, name, entry.key],
      }),
    );
  });
```

(`programmeKeys` already exists in `parsePack`: it is `pack.site.programmes.map((p) => p.key)`.)

- [ ] **Step 4: Add the placeholder levels to both packs**

In `packs/royal-softech/pack.json`, replace the single line `  "modules": {},` with:

```json
  "academics": {
    "programmes": [
      { "key": "plus2-sample", "levels": ["Grade 11", "Grade 12"] },
      { "key": "bachelors-sample", "levels": ["Year 1", "Year 2", "Year 3", "Year 4"] }
    ]
  },
  "modules": {},
```

In `packs/sample-basic-school/pack.json`, replace the single line `  "modules": { "notes": false, "top20": false },` with:

```json
  "academics": {
    "programmes": [
      { "key": "early-years", "levels": ["Nursery", "KG"] },
      { "key": "primary", "levels": ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"] },
      { "key": "lower-secondary", "levels": ["Grade 6", "Grade 7", "Grade 8"] },
      { "key": "secondary", "levels": ["Grade 9", "Grade 10"] }
    ]
  },
  "modules": { "notes": false, "top20": false },
```

(Royal's levels are placeholders for the programme list the client has not confirmed; they stay marked `OPEN:` in DECISIONS.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && npx vitest run test/academics-pack.test.ts test/packs.test.ts test/sql-render.test.ts`
Expected: PASS. If `packs.test.ts` or a web test that reads the pack JSON fails on the new `academics` key, the cause is a test that lists the pack's keys: update that test to allow the new block, do not remove the block.

- [ ] **Step 6: Run everything, and check the provision script still renders**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS, no output from tsc and eslint.

Run: `cd apps/web && npx vitest run`
Expected: PASS (web tests read the pack JSON directly).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/config/pack.ts apps/api/test/academics-pack.test.ts packs
git commit -m "Slice 1: the pack seeds programmes and levels, only where missing" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: The web app's model, client and words

**Files:**
- Create: `apps/web/src/setup/model.ts`, `apps/web/src/setup/client.ts`
- Modify: `apps/web/src/content/client.ts` (export two names), `apps/web/src/i18n/messages.ts` (new keys)
- Test: `apps/web/test/setup-model.test.ts`, `apps/web/test/setup-client.test.ts`

**Interfaces:**
- Consumes: the generated `components["schemas"]` names `AcademicYear`, `Programme`, `Level`, `SchoolClass`, `Terminal` (Task 6, step 9); `toAd` from `@/content/client`.
- Produces:
  - `model.ts`: types `Year`, `Programme`, `Level`, `SchoolClass`, `Terminal`; `canManageStructure(roles)`, `canManageInstitution(roles)`, `manageableSections(roles, sections)`, `defaultYearId(years)`, `levelChoices(programmes)`, `classTitle(c)`, `termWords(term)`, `YEAR_STATUS_LABEL`, `REASON_MESSAGE`, `type FailReason`, `type YearFormValues`, `emptyYearForm()`, `validateYearForm(values)`, `type YearFormErrors`.
  - `client.ts`: `type Loaded<T>`; loads `loadYears(api)`, `loadProgrammes(api)`, `loadClasses(api, yearId)`, `loadTerminals(api, yearId)`; writes (all return `WriteResult` = `{ ok: true } | { ok: false; reason: FailReason }`, or `CreateResult` = `{ ok: true; id: string } | { ok: false; reason: FailReason }`): `createYear(api, values)` (also `reason: "fields"` with `errors`), `activateYear(api, id)`, `createProgramme(api, { name, sectionKey, affiliation })`, `addLevel(api, programmeId, name)`, `setProgrammeActive(api, id, active)`, `setLevelActive(api, id, active)`, `createClass(api, { yearId, levelId, label })`, `setClassActive(api, id, active)`, `createTerminal(api, { yearId, name })`.

- [ ] **Step 1: Write the failing model tests**

Create `apps/web/test/setup-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  REASON_MESSAGE,
  canManageInstitution,
  canManageStructure,
  classTitle,
  defaultYearId,
  emptyYearForm,
  levelChoices,
  manageableSections,
  termWords,
  validateYearForm,
  type Programme,
  type SchoolClass,
  type Year,
} from "@/setup/model";

const role = (r: string, scope: string, section?: string) => ({ role: r, scope, ...(section ? { section } : {}) });
const year = (id: string, status: Year["status"]): Year => ({ id, bsYear: 2083, label: id, startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", status });

describe("who sees the change controls (tidiness only; the API decides)", () => {
  it("the Co-ordinator and the Super Admin may change the structure; nobody else", () => {
    expect(canManageStructure([role("coordinator", "institution")])).toBe(true);
    expect(canManageStructure([role("coordinator", "section", "plus2")])).toBe(true);
    expect(canManageStructure([role("super_admin", "institution")])).toBe(true);
    for (const other of ["admin", "accountant", "teacher", "student"]) expect(canManageStructure([role(other, "institution")]), other).toBe(false);
    expect(canManageStructure([])).toBe(false);
  });

  it("years and terminals need a whole-school Co-ordinator (or the Super Admin)", () => {
    expect(canManageInstitution([role("coordinator", "institution")])).toBe(true);
    expect(canManageInstitution([role("super_admin", "institution")])).toBe(true);
    expect(canManageInstitution([role("coordinator", "section", "plus2")])).toBe(false);
    expect(canManageInstitution([role("admin", "institution")])).toBe(false);
  });

  it("a section-scoped Co-ordinator may add programmes only to their own section", () => {
    const sections = [{ key: "plus2", name: "+2" }, { key: "bachelors", name: "Bachelor's" }];
    expect(manageableSections([role("coordinator", "institution")], sections)).toEqual(sections);
    expect(manageableSections([role("coordinator", "section", "plus2")], sections)).toEqual([sections[0]]);
    expect(manageableSections([role("admin", "institution")], sections)).toEqual([]);
  });
});

describe("defaultYearId", () => {
  it("is the active year, else the newest (the API lists newest first), else nothing", () => {
    expect(defaultYearId([year("new", "draft"), year("current", "active"), year("old", "closed")])).toBe("current");
    expect(defaultYearId([year("new", "draft"), year("old", "closed")])).toBe("new");
    expect(defaultYearId([])).toBeNull();
  });
});

describe("levelChoices", () => {
  const programmes: Programme[] = [
    { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true }, { id: "l2", ordinal: 2, name: "Year 2", active: false }] },
    { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true }] },
  ];
  it("lists only the active levels of active programmes, named with their programme", () => {
    expect(levelChoices(programmes)).toEqual([{ value: "l1", label: "BBS · Year 1" }]);
  });
});

describe("classTitle", () => {
  const base: SchoolClass = { id: "c", yearId: "y", programmeId: "p", programmeName: "BBS", sectionKey: "bachelors", levelId: "l", levelName: "Year 1", label: "", active: true };
  it("reads programme and level, and the label in brackets when there is one", () => {
    expect(classTitle(base)).toBe("BBS · Year 1");
    expect(classTitle({ ...base, label: "Morning" })).toBe("BBS · Year 1 (Morning)");
  });
});

describe("validateYearForm", () => {
  it("wants a four-digit year and both days", () => {
    expect(validateYearForm(emptyYearForm())).toEqual({ bsYear: "setup.error.bsYear", startBs: "setup.error.startRequired", endBs: "setup.error.endRequired" });
    expect(validateYearForm({ bsYear: "20x3", startBs: "2083-01-01", endBs: "2083-12-30" })).toEqual({ bsYear: "setup.error.bsYear" });
    expect(validateYearForm({ bsYear: " 2083 ", startBs: "2083-01-01", endBs: "2083-12-30" })).toEqual({});
  });
});

describe("words", () => {
  it("every failure reason has words", () => {
    for (const reason of ["forbidden", "not_found", "conflict", "year_closed", "another_active", "rejected", "failed"] as const) expect(REASON_MESSAGE[reason]).toMatch(/^setup\.error\./);
  });

  it("the school's own words for programme, level, section and terminal come from its configuration", () => {
    const term = (key: string) => ({ "term.terminal": "Exam" })[key as "term.terminal"] ?? key;
    expect(termWords(term)).toEqual({ programme: "term.programme", level: "term.level", section: "term.section", terminal: "Exam" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/setup-model.test.ts`
Expected: FAIL: cannot find module `@/setup/model`.

- [ ] **Step 3: Add the words**

In `apps/web/src/i18n/messages.ts`, directly after the single line `  "nav.content": "Website",`, insert:

```ts
  "nav.setup": "Setup",

  // Setup: years, programmes, classes, terminals (Phase 3). {programme}, {level}, {section} and {terminal} are the school's own words.
  "setup.tabs": "Setup sections",
  "setup.tab.years": "Years",
  "setup.tab.programmes": "{programme}s",
  "setup.tab.classes": "Classes",
  "setup.tab.terminals": "{terminal}s",
  "setup.loading": "Loading…",
  "setup.loadFailed": "This could not be loaded. Check your connection and try again.",
  "setup.forbidden": "You do not have access to this page.",
  "setup.retry": "Try again",
  "setup.working": "Working…",
  "setup.saved": "Saved.",
  "setup.readOnly": "You can look at this, but only a {coordinator} can change it.",
  "setup.institutionOnly": "This belongs to the whole school, so only a {coordinator} for the whole school can change it.",
  "setup.yearPicker": "Year",
  "setup.status.draft": "Not started",
  "setup.status.active": "Current year",
  "setup.status.closed": "Closed",
  "setup.error.failed": "That did not go through. Nothing was changed. Try again.",
  "setup.error.forbidden": "You are not allowed to do that.",
  "setup.error.gone": "That is no longer there. Reload the page.",
  "setup.error.conflict": "That already exists.",
  "setup.error.yearClosed": "That year is closed, so it cannot be changed.",
  "setup.error.anotherActive": "Another year is already the current year.",
  "setup.error.rejected": "That is not allowed. Check what you entered.",
  "setup.error.dateInvalid": "That day does not exist.",
  "setup.error.dateUnverified": "The calendar for that year has not been checked yet.",
  "setup.error.bsYear": "Enter the year as four digits, for example 2083.",
  "setup.error.startRequired": "Enter the first day of the year.",
  "setup.error.endRequired": "Enter the last day of the year.",
  "setup.error.nameRequired": "Enter a name.",
  "setup.error.affiliationRequired": "Enter the affiliation, for example NEB.",
  "setup.error.sectionRequired": "Choose a {section}.",
  "setup.error.levelRequired": "Choose a {level}.",
  "setup.years.title": "Academic years",
  "setup.years.empty": "No year yet. Add the first one.",
  "setup.years.add": "Add a year",
  "setup.years.bsYear": "Year (BS)",
  "setup.years.bsYearHint": "For example 2083.",
  "setup.years.start": "First day",
  "setup.years.end": "Last day",
  "setup.years.dates": "{from} to {until}",
  "setup.years.activate": "Make current",
  "setup.years.activateItem": "Make {label} the current year",
  "setup.programmes.title": "{programme}s and {level}s",
  "setup.programmes.empty": "No {programme} yet.",
  "setup.programmes.add": "Add a {programme}",
  "setup.programmes.name": "Name",
  "setup.programmes.affiliation": "Affiliation",
  "setup.programmes.affiliationHint": "For example NEB, TU or PU.",
  "setup.programmes.section": "{section}",
  "setup.programmes.choose": "Choose…",
  "setup.programmes.noLevels": "No {level}s yet.",
  "setup.programmes.levelsOf": "{level}s of {name}",
  "setup.programmes.addLevel": "Add a {level}",
  "setup.programmes.levelName": "{level} name",
  "setup.programmes.off": "Switched off",
  "setup.programmes.switchOff": "Switch off",
  "setup.programmes.switchOn": "Switch on",
  "setup.programmes.switchOffItem": "Switch off {name}",
  "setup.programmes.switchOnItem": "Switch on {name}",
  "setup.classes.title": "Classes",
  "setup.classes.empty": "No classes in this year yet.",
  "setup.classes.noYear": "Add a year first, then add its classes.",
  "setup.classes.add": "Add a class",
  "setup.classes.level": "{level}",
  "setup.classes.label": "Label (optional)",
  "setup.classes.labelHint": "For example Morning or Evening.",
  "setup.classes.off": "Switched off",
  "setup.classes.switchOffItem": "Switch off {name}",
  "setup.classes.switchOnItem": "Switch on {name}",
  "setup.terminals.title": "{terminal}s",
  "setup.terminals.empty": "No {terminal}s in this year yet.",
  "setup.terminals.add": "Add a {terminal}",
  "setup.terminals.name": "Name",
  "setup.terminals.number": "Number {n}",
```

- [ ] **Step 4: Write the model**

Create `apps/web/src/setup/model.ts`:

```ts
import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";

export type Year = components["schemas"]["AcademicYear"];
export type Programme = components["schemas"]["Programme"];
export type Level = components["schemas"]["Level"];
export type SchoolClass = components["schemas"]["SchoolClass"];
export type Terminal = components["schemas"]["Terminal"];

export interface RoleView {
  role: string;
  scope: string;
  section?: string | undefined;
}

/**
 * Who sees the change controls. Only tidiness: the API decides what a person may actually do (D-025), and
 * shows the Admin the same data, read-only.
 */
export const canManageStructure = (roles: readonly RoleView[]): boolean => roles.some((r) => r.role === "super_admin" || r.role === "coordinator");

/** Years and terminals belong to the whole school: a section-scoped Co-ordinator does not change them. */
export const canManageInstitution = (roles: readonly RoleView[]): boolean =>
  roles.some((r) => r.role === "super_admin" || (r.role === "coordinator" && r.scope === "institution"));

/** The sections a person may add programmes to: every section, or only their own. */
export function manageableSections<S extends { key: string }>(roles: readonly RoleView[], sections: readonly S[]): S[] {
  if (canManageInstitution(roles)) return [...sections];
  const own = new Set(roles.filter((r) => r.role === "coordinator" && r.scope === "section" && r.section).map((r) => r.section));
  return sections.filter((s) => own.has(s.key));
}

/** The year a screen starts on: the current one, else the newest (the API lists newest first). */
export function defaultYearId(years: readonly Year[]): string | null {
  return years.find((y) => y.status === "active")?.id ?? years[0]?.id ?? null;
}

/** What a class picker offers: the active levels of active programmes, named with their programme. */
export function levelChoices(programmes: readonly Programme[]): { value: string; label: string }[] {
  return programmes.filter((p) => p.active).flatMap((p) => p.levels.filter((l) => l.active).map((l) => ({ value: l.id, label: `${p.name} · ${l.name}` })));
}

export const classTitle = (c: SchoolClass): string => `${c.programmeName} · ${c.levelName}${c.label ? ` (${c.label})` : ""}`;

/** The school's own words for the things setup is about (they can be renamed, so they are never in the catalog). */
export const termWords = (term: (key: string) => string) => ({
  programme: term("term.programme"),
  level: term("term.level"),
  section: term("term.section"),
  terminal: term("term.terminal"),
});

export const YEAR_STATUS_LABEL: Record<Year["status"], MessageKey> = {
  draft: "setup.status.draft",
  active: "setup.status.active",
  closed: "setup.status.closed",
};

export type FailReason = "forbidden" | "not_found" | "conflict" | "year_closed" | "another_active" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "setup.error.forbidden",
  not_found: "setup.error.gone",
  conflict: "setup.error.conflict",
  year_closed: "setup.error.yearClosed",
  another_active: "setup.error.anotherActive",
  rejected: "setup.error.rejected",
  failed: "setup.error.failed",
};

export interface YearFormValues {
  bsYear: string;
  startBs: string;
  endBs: string;
}
export const emptyYearForm = (): YearFormValues => ({ bsYear: "", startBs: "", endBs: "" });
export type YearFormErrors = Partial<Record<keyof YearFormValues, MessageKey>>;

/** The checks that need no server. Whether a Nepali day exists, and whether its year is verified, is the server's to say. */
export function validateYearForm(values: YearFormValues): YearFormErrors {
  const errors: YearFormErrors = {};
  if (!/^\d{4}$/.test(values.bsYear.trim())) errors.bsYear = "setup.error.bsYear";
  if (!values.startBs.trim()) errors.startBs = "setup.error.startRequired";
  if (!values.endBs.trim()) errors.endBs = "setup.error.endRequired";
  return errors;
}
```

- [ ] **Step 5: Run the model tests, and fix the generated type names if needed**

Run: `cd apps/web && npx vitest run test/setup-model.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` says `components["schemas"]["AcademicYear"]` (or another name) does not exist, open `apps/web/src/api/schema.d.ts`, find the names generated for the Task 6 schemas, and correct the five type aliases in `model.ts`; do not rename the API schemas.

- [ ] **Step 6: Export the date helper the client needs**

In `apps/web/src/content/client.ts`, change the single line `type DateOutcome = ...` to start with `export`, and the single line `async function toAd(api: ApiClient, bs: string): Promise<DateOutcome> {` to start with `export`:

```ts
export type DateOutcome = { ok: true; ad: string } | { ok: false; error: "dateInvalid" | "dateUnverified" } | { ok: false; error: "failed" };
```

```ts
export async function toAd(api: ApiClient, bs: string): Promise<DateOutcome> {
```

- [ ] **Step 7: Write the failing client tests**

Create `apps/web/test/setup-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import {
  activateYear,
  addLevel,
  createClass,
  createProgramme,
  createTerminal,
  createYear,
  loadClasses,
  loadProgrammes,
  loadTerminals,
  loadYears,
  setClassActive,
  setLevelActive,
  setProgrammeActive,
} from "@/setup/client";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** A client whose "network" answers from a script and remembers every request. */
function fake(answer: (seen: Seen) => Response | "offline") {
  const seen: Seen[] = [];
  const api = createApiClient({
    baseUrl: "http://school.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      const entry: Seen = { method: request.method, path: url.pathname + url.search, body: request.method === "GET" ? undefined : await request.clone().json().catch(() => undefined) };
      seen.push(entry);
      const result = answer(entry);
      if (result === "offline") throw new TypeError("offline");
      return result;
    },
  });
  return { api, seen };
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id = "a".repeat(32);

describe("loading", () => {
  it("returns the data on 200", async () => {
    const { api, seen } = fake(() => reply(200, { years: [] }));
    expect(await loadYears(api)).toEqual({ ok: true, data: { years: [] } });
    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/academics/years" });
  });

  it("asks for one year's classes and terminals by query", async () => {
    const { api, seen } = fake(() => reply(200, { classes: [], terminals: [] }));
    await loadClasses(api, id);
    await loadTerminals(api, id);
    expect(seen.map((s) => s.path)).toEqual([`/api/academics/classes?year=${id}`, `/api/academics/terminals?year=${id}`]);
  });

  it("403 is forbidden, any other failure and a dropped connection are failed", async () => {
    expect(await loadProgrammes(fake(() => reply(403, { error: "forbidden" })).api)).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadProgrammes(fake(() => reply(500, {})).api)).toEqual({ ok: false, reason: "failed" });
    expect(await loadProgrammes(fake(() => "offline").api)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("createYear", () => {
  const values = { bsYear: "2083", startBs: "2083-01-01", endBs: "2083-12-30" };
  const script = (seen: Seen) => {
    if (seen.path.startsWith("/api/dates/to-ad")) return reply(200, { ad: seen.path.includes("2083-01-01") ? "2026-04-14" : "2027-04-13" });
    return reply(201, { id });
  };

  it("converts both Nepali days on the server, then sends the AD days and the BS year", async () => {
    const { api, seen } = fake(script);
    expect(await createYear(api, values)).toEqual({ ok: true, id });
    const post = seen.find((s) => s.method === "POST")!;
    expect(post).toMatchObject({ path: "/api/academics/years", body: { bsYear: 2083, startDate: "2026-04-14", endDate: "2027-04-13" } });
  });

  it("checks the form first and sends nothing when it is empty", async () => {
    const { api, seen } = fake(script);
    const result = await createYear(api, { bsYear: "", startBs: "", endBs: "" });
    expect(result).toMatchObject({ ok: false, reason: "fields", errors: { bsYear: "setup.error.bsYear", startBs: "setup.error.startRequired", endBs: "setup.error.endRequired" } });
    expect(seen).toEqual([]);
  });

  it("a day that does not exist, or whose year is not verified, comes back against its own field, and nothing is created", async () => {
    const invalid = fake((s) => (s.path.includes("2083-01-01") ? reply(422, { error: "invalid_date" }) : script(s)));
    expect(await createYear(invalid.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { startBs: "setup.error.dateInvalid" } });
    expect(invalid.seen.some((s) => s.method === "POST")).toBe(false);

    const unverified = fake((s) => (s.path.includes("2083-12-30") ? reply(422, { error: "unverified_year" }) : script(s)));
    expect(await createYear(unverified.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { endBs: "setup.error.dateUnverified" } });
  });

  it("maps the server's answers: 422 rejected, 409 conflict, 403 forbidden, a dropped connection failed", async () => {
    const withPost = (status: number, body: unknown) => fake((s) => (s.method === "POST" ? reply(status, body) : script(s))).api;
    expect(await createYear(withPost(422, { error: "invalid", message: "x" }), values)).toEqual({ ok: false, reason: "rejected" });
    expect(await createYear(withPost(409, { error: "conflict" }), values)).toEqual({ ok: false, reason: "conflict" });
    expect(await createYear(withPost(403, { error: "forbidden" }), values)).toEqual({ ok: false, reason: "forbidden" });
    expect(await createYear(fake((s) => (s.method === "POST" ? "offline" : script(s))).api, values)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the other writes", () => {
  it("send what the API expects", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    await createProgramme(api, { name: "BBS", sectionKey: "bachelors", affiliation: "TU" });
    await addLevel(api, id, "Year 1");
    await createClass(api, { yearId: id, levelId: id, label: "Morning" });
    await createTerminal(api, { yearId: id, name: "First" });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/academics/programmes", { name: "BBS", sectionKey: "bachelors", affiliation: "TU" }],
      ["POST", `/api/academics/programmes/${id}/levels`, { name: "Year 1" }],
      ["POST", "/api/academics/classes", { yearId: id, levelId: id, label: "Morning" }],
      ["POST", "/api/academics/terminals", { yearId: id, name: "First" }],
    ]);
  });

  it("switch things off and on, and make a year current", async () => {
    const { api, seen } = fake(() => reply(200, { ok: true }));
    expect(await setProgrammeActive(api, id, false)).toEqual({ ok: true });
    await setLevelActive(api, id, true);
    await setClassActive(api, id, false);
    await activateYear(api, id);
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/academics/programmes/${id}`, { active: false }],
      ["PATCH", `/api/academics/levels/${id}`, { active: true }],
      ["PATCH", `/api/academics/classes/${id}`, { active: false }],
      ["POST", `/api/academics/years/${id}/activate`, undefined],
    ]);
  });

  it("409 keeps its word: a closed year and another active year are told apart from a repeat", async () => {
    const closed = fake(() => reply(409, { error: "year_closed" })).api;
    expect(await createClass(closed, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await createTerminal(closed, { yearId: id, name: "x" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await activateYear(fake(() => reply(409, { error: "another_active" })).api, id)).toEqual({ ok: false, reason: "another_active" });
    expect(await createClass(fake(() => reply(409, { error: "conflict" })).api, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "conflict" });
  });

  it("404 is not_found, and a dropped connection is failed, for every write", async () => {
    const gone = fake(() => reply(404, { error: "not_found" })).api;
    expect(await addLevel(gone, id, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await setClassActive(gone, id, true)).toEqual({ ok: false, reason: "not_found" });
    const offline = fake(() => "offline").api;
    expect(await createProgramme(offline, { name: "x", sectionKey: "plus2", affiliation: "y" })).toEqual({ ok: false, reason: "failed" });
    expect(await activateYear(offline, id)).toEqual({ ok: false, reason: "failed" });
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/setup-client.test.ts`
Expected: FAIL: cannot find module `@/setup/client`.

- [ ] **Step 9: Write the client**

Create `apps/web/src/setup/client.ts`:

```ts
import type { ApiClient } from "@/api/client";
import { toAd } from "@/content/client";

import { validateYearForm, type FailReason, type YearFormErrors, type YearFormValues } from "./model";

/**
 * Everything the setup screens ask of the server, with the answers turned into plain results the screens can
 * act on. Nothing here throws: a dropped connection is `failed`, like any other error.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const loadYears = (api: ApiClient) => load(() => api.GET("/api/academics/years"));
export const loadProgrammes = (api: ApiClient) => load(() => api.GET("/api/academics/programmes"));
export const loadClasses = (api: ApiClient, yearId: string) => load(() => api.GET("/api/academics/classes", { params: { query: { year: yearId } } }));
export const loadTerminals = (api: ApiClient, yearId: string) => load(() => api.GET("/api/academics/terminals", { params: { query: { year: yearId } } }));

export type WriteResult = { ok: true } | { ok: false; reason: FailReason };
export type CreateResult = { ok: true; id: string } | { ok: false; reason: FailReason };

/** What a failed write means, from the status and the API's word for a 409. */
function reasonOf(response: Response, error: unknown): FailReason {
  const status = response.status;
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) {
    const code = (error as { error?: string } | undefined)?.error;
    return code === "year_closed" || code === "another_active" ? code : "conflict";
  }
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

type Sent = { ok: true; data: unknown } | { ok: false; reason: FailReason };

async function send(run: () => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<Sent> {
  try {
    const { data, error, response } = await run();
    return response.ok ? { ok: true, data } : { ok: false, reason: reasonOf(response, error) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const done = (sent: Sent): WriteResult => (sent.ok ? { ok: true } : sent);
const created = (sent: Sent): CreateResult => (sent.ok ? { ok: true, id: (sent.data as { id: string }).id } : sent);

export type YearResult = CreateResult | { ok: false; reason: "fields"; errors: YearFormErrors };

/**
 * Adds a year. The form is checked first, then the two Nepali days are converted by the server (only the date
 * module converts, D-014), and only then is anything written. A problem with a day comes back against its own field.
 */
export async function createYear(api: ApiClient, values: YearFormValues): Promise<YearResult> {
  const problems = validateYearForm(values);
  if (Object.keys(problems).length > 0) return { ok: false, reason: "fields", errors: problems };

  const [start, end] = await Promise.all([toAd(api, values.startBs.trim()), toAd(api, values.endBs.trim())]);
  const errors: YearFormErrors = {};
  if (!start.ok && start.error !== "failed") errors.startBs = start.error === "dateUnverified" ? "setup.error.dateUnverified" : "setup.error.dateInvalid";
  if (!end.ok && end.error !== "failed") errors.endBs = end.error === "dateUnverified" ? "setup.error.dateUnverified" : "setup.error.dateInvalid";
  if (Object.keys(errors).length > 0) return { ok: false, reason: "fields", errors };
  if (!start.ok || !end.ok) return { ok: false, reason: "failed" };

  return created(await send(() => api.POST("/api/academics/years", { body: { bsYear: Number(values.bsYear.trim()), startDate: start.ad, endDate: end.ad } })));
}

export const activateYear = async (api: ApiClient, id: string): Promise<WriteResult> =>
  done(await send(() => api.POST("/api/academics/years/{id}/activate", { params: { path: { id } } })));

export const createProgramme = async (api: ApiClient, body: { name: string; sectionKey: string; affiliation: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes", { body })));

export const setProgrammeActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/programmes/{id}", { params: { path: { id } }, body: { active } })));

export const addLevel = async (api: ApiClient, programmeId: string, name: string): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes/{id}/levels", { params: { path: { id: programmeId } }, body: { name } })));

export const setLevelActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/levels/{id}", { params: { path: { id } }, body: { active } })));

export const createClass = async (api: ApiClient, body: { yearId: string; levelId: string; label: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/classes", { body })));

export const setClassActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/classes/{id}", { params: { path: { id } }, body: { active } })));

export const createTerminal = async (api: ApiClient, body: { yearId: string; name: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/terminals", { body })));
```

- [ ] **Step 10: Run to verify it passes**

Run: `cd apps/web && npx vitest run test/setup-model.test.ts test/setup-client.test.ts && npx tsc --noEmit && npx eslint src/setup src/content/client.ts test/setup-model.test.ts test/setup-client.test.ts`
Expected: PASS, no output from tsc and eslint. In the `createYear` "invalid day" test the fake answers `/api/dates/to-ad` with `{ error: "invalid_date" }` and 422: `toAd` maps a 422 whose `error` is not `unverified_year` to `dateInvalid`. If `tsc` complains about `load`'s parameter type for an `api.GET` result, widen the parameter to `() => Promise<{ data?: T | undefined; response: Response }>` and leave the rest.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/setup apps/web/src/content/client.ts apps/web/src/i18n/messages.ts apps/web/test/setup-model.test.ts apps/web/test/setup-client.test.ts
git commit -m "Slice 1: the web model and client for setup, and the words" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: The Setup screens

**Files:**
- Create: `apps/web/src/setup/setup.module.css`, `useLoad.tsx`, `SetupLayout.tsx`, `YearsScreen.tsx`, `ProgrammesScreen.tsx`, `ClassesScreen.tsx`, `TerminalsScreen.tsx`
- Create: `apps/web/src/app/portal/setup/page.tsx`, `programmes/page.tsx`, `classes/page.tsx`, `terminals/page.tsx`
- Modify: `apps/web/src/shell/nav.ts`, `apps/web/test/nav.test.ts`, `apps/web/page-weight-budget.json`
- Test: `apps/web/test/setup-screens.test.tsx`

**Interfaces:**
- Consumes: Task 8's model and client; `useSession()` (`api`, `me`), `useConfig()` (`config`, `term`), `Badge`, `Button`, `Field`, `Notice`, `Select`, `Skeleton` from `@/ui`, `BsDateField` from `@/content/BsDateField`, `formatBsDate` from `@/content/model`, `PortalShell`.
- Produces: `SetupLayout`, `SetupTabs({ pathname })`, `YearsScreen`/`YearsView`, `ProgrammesScreen`/`ProgrammesView`, `ClassesScreen`/`ClassesView`/`ClassForm`, `TerminalsScreen`/`TerminalsView`; pages at `/portal/setup`, `/portal/setup/programmes`, `/portal/setup/classes`, `/portal/setup/terminals`; the Setup menu entry for Co-ordinator, Admin and Super Admin.

- [ ] **Step 0: Design before building (the house rule)**

Invoke the `ui-ux-pro-max` skill (Skill tool) and follow its `SKILL.md` for the Next.js static-export stack. Run only the smallest searches that fit these screens: the UX guidance for **forms** and for **lists/tables**, and the **navigation** guidance for a four-item sub-menu. Never use `--persist`. Treat what it returns as advice: colours, fonts and radii come from theme tokens only, and no library is added. Note which searches you ran; they are listed in the slice's final report. If the design advice changes a decision below (for example the tabs), change the plan's code accordingly and say so in the report.

- [ ] **Step 1: Write the failing screen tests**

Create `apps/web/test/setup-screens.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SetupPage from "@/app/portal/setup/page";
import ProgrammesPage from "@/app/portal/setup/programmes/page";
import ClassesPage from "@/app/portal/setup/classes/page";
import TerminalsPage from "@/app/portal/setup/terminals/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SetupTabs } from "@/setup/SetupLayout";
import { ClassForm, ClassesView } from "@/setup/ClassesScreen";
import { ProgrammesView } from "@/setup/ProgrammesScreen";
import { TerminalsView } from "@/setup/TerminalsScreen";
import { YearsScreen, YearsView } from "@/setup/YearsScreen";
import type { Programme, SchoolClass, Terminal, Year } from "@/setup/model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/setup", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royal.sections,
  modules: {},
  terms: { "term.programme": "Programme", "term.level": "Level", "term.section": "Section", "term.terminal": "Exam", "role.coordinator": "Vice Principal" },
  theme: royal.theme as PublicConfig["theme"],
};

const as = (role: string, scope: "institution" | "section", section?: string) =>
  fakeSession({ status: "signedIn", me: { name: "Sita", roles: [{ role, scope, ...(section ? { section } : {}) }] } });
const inContext = (element: React.ReactNode, session = as("coordinator", "institution")) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const year = (id: string, label: string, status: Year["status"]): Year => ({ id, bsYear: 2083, label, startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", status });
const noop = () => {};

// ---------------------------------------------------------------------------------------------
describe("the sub-menu", () => {
  it("links to the four screens, marks exactly the current one, and uses the school's own words", () => {
    const html = inContext(<SetupTabs pathname="/portal/setup/terminals" />);
    for (const href of ["/portal/setup", "/portal/setup/programmes", "/portal/setup/classes", "/portal/setup/terminals"]) expect(html).toContain(`href="${href}"`);
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Exams</);
    expect(html).toContain(">Programmes<");
    expect(html).toContain('aria-label="Setup sections"');
  });

  it("a trailing slash in the address still marks the right one", () => {
    expect(inContext(<SetupTabs pathname="/portal/setup/classes/" />)).toMatch(/aria-current="page"[^>]*>Classes</);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the years screen", () => {
  const years = [year("y3", "2084", "draft"), year("y2", "2083", "active"), year("y1", "2082", "closed")];

  it("lists each year with its Nepali days and where it stands", () => {
    const html = inContext(<YearsView years={years} canManage busy={null} onActivate={noop} />);
    for (const label of ["2084", "2083", "2082"]) expect(html).toContain(`>${label}</h2>`);
    expect(html).toContain("1 Baisakh 2083");
    expect(html).toContain(">Current year<");
    expect(html).toContain(">Closed<");
    expect(html).toContain(">Not started<");
  });

  it("offers 'Make current' only for a draft, and only when no year is current", () => {
    const withCurrent = inContext(<YearsView years={years} canManage busy={null} onActivate={noop} />);
    expect(withCurrent).not.toContain("Make current");
    const none = inContext(<YearsView years={[year("y3", "2084", "draft")]} canManage busy={null} onActivate={noop} />);
    expect(none).toContain('aria-label="Make 2084 the current year"');
    expect(inContext(<YearsView years={[year("y3", "2084", "draft")]} canManage={false} busy={null} onActivate={noop} />)).not.toContain("Make current");
  });

  it("says so when there is no year yet", () => {
    expect(inContext(<YearsView years={[]} canManage busy={null} onActivate={noop} />)).toContain("No year yet");
  });

  it("shows the shape of the page while it loads, and the add form to a whole-school Co-ordinator", () => {
    const html = inContext(<YearsScreen />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain(">Add a year<");
    expect(html).toContain(">Year (BS)<");
    expect(html).toContain(">First day<");
    expect(html).toContain(">Last day<");
    expect(html).toContain('inputmode="numeric"');
  });

  it("a section-scoped Co-ordinator and the Admin see no add form, and are told why in the school's words", () => {
    const section = inContext(<YearsScreen />, as("coordinator", "section", "plus2"));
    expect(section).not.toContain("Add a year");
    expect(section).toContain("whole school");
    expect(section).toContain("Vice Principal");
    const admin = inContext(<YearsScreen />, as("admin", "institution"));
    expect(admin).not.toContain("Add a year");
    expect(admin).toContain("only a Vice Principal can change it");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the programmes screen", () => {
  const programmes: Programme[] = [
    { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true }, { id: "l2", ordinal: 2, name: "Year 2", active: false }] },
    { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, levels: [] },
  ];
  const view = (canManage: boolean) => inContext(<ProgrammesView programmes={programmes} canManage={canManage} busy={null} onToggleProgramme={noop} onToggleLevel={noop} onAddLevel={async () => true} />);

  it("lists each programme with its section, affiliation and levels in order", () => {
    const html = view(false);
    expect(html).toContain(">BBS</h2>");
    expect(html).toContain(">TU<");
    expect(html.indexOf("Year 1")).toBeLessThan(html.indexOf("Year 2"));
    expect(html).toContain(">Switched off<");
    expect(html).toContain("No Levels yet.");
  });

  it("gives the change controls only to someone who can change things", () => {
    const html = view(true);
    expect(html).toContain('aria-label="Switch off BBS"');
    expect(html).toContain('aria-label="Switch on Old"');
    expect(html).toContain(">Level name<");
    expect(count(html, /<form/g)).toBeGreaterThanOrEqual(1);
    const readOnly = view(false);
    expect(readOnly).not.toContain("Switch off");
    expect(count(readOnly, /<form/g)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the classes screen", () => {
  const classes: SchoolClass[] = [
    { id: "c1", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "Morning", active: true },
    { id: "c2", yearId: "y", programmeId: "p1", programmeName: "BBS", sectionKey: "bachelors", levelId: "l1", levelName: "Year 1", label: "", active: false },
  ];

  it("lists each class by programme, level and label, and marks one that is switched off", () => {
    const html = inContext(<ClassesView classes={classes} canManage busy={null} onToggle={noop} />);
    expect(html).toContain(">BBS · Year 1 (Morning)</h2>");
    expect(html).toContain(">BBS · Year 1</h2>");
    expect(html).toContain(">Switched off<");
    expect(html).toContain('aria-label="Switch off BBS · Year 1 (Morning)"');
    expect(inContext(<ClassesView classes={classes} canManage={false} busy={null} onToggle={noop} />)).not.toContain("Switch off BBS");
  });

  it("says so when the year has no classes", () => {
    expect(inContext(<ClassesView classes={[]} canManage busy={null} onToggle={noop} />)).toContain("No classes in this year yet.");
  });

  it("the form offers only active levels of active programmes", () => {
    const programmes: Programme[] = [
      { id: "p1", key: "bbs", name: "BBS", section: { key: "bachelors", name: "Bachelor's" }, affiliation: "TU", active: true, levels: [{ id: "l1", ordinal: 1, name: "Year 1", active: true }, { id: "l2", ordinal: 2, name: "Year 2", active: false }] },
      { id: "p2", key: "old", name: "Old", section: { key: "plus2", name: "+2" }, affiliation: "NEB", active: false, levels: [{ id: "l3", ordinal: 1, name: "Grade 11", active: true }] },
    ];
    const html = inContext(<ClassForm yearId="y" programmes={programmes} onAdded={noop} />);
    expect(html).toContain("BBS · Year 1");
    expect(html).not.toContain("Year 2");
    expect(html).not.toContain("Old · Grade 11");
    expect(html).toContain("Label (optional)");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the terminals screen", () => {
  const terminals: Terminal[] = [{ id: "t1", yearId: "y", name: "First terminal", ordinal: 1 }, { id: "t2", yearId: "y", name: "Second terminal", ordinal: 2 }];

  it("lists terminals in order, with their number", () => {
    const html = inContext(<TerminalsView terminals={terminals} />);
    expect(html.indexOf("First terminal")).toBeLessThan(html.indexOf("Second terminal"));
    expect(html).toContain("Number 1");
    expect(html).toContain("Number 2");
  });

  it("uses the school's word for the empty state", () => {
    expect(inContext(<TerminalsView terminals={[]} />)).toContain("No Exams in this year yet.");
  });
});

// ---------------------------------------------------------------------------------------------
describe("the pages", () => {
  it.each([
    ["years", SetupPage, "Academic years"],
    ["programmes", ProgrammesPage, "Programmes and Levels"],
    ["classes", ClassesPage, "Classes"],
    ["terminals", TerminalsPage, "Exams"],
  ] as const)("%s: a heading, the sub-menu, and the portal around it", (_name, Page, title) => {
    const html = inContext(<Page />);
    expect(html).toContain(`>${title}</h1>`);
    expect(html).toContain('aria-label="Setup sections"');
    expect(html).toContain("Skip to main content");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/setup-screens.test.tsx`
Expected: FAIL: cannot find module `@/app/portal/setup/page`.

- [ ] **Step 3: Write the styles**

Create `apps/web/src/setup/setup.module.css`:

```css
/* Setup screens (Phase 3). Tokens only: no colour, font or motion is written out here. */

.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.title {
  font-size: var(--text-2xl);
}

.muted {
  color: var(--color-text-muted);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 1px solid var(--color-border);
}

.tab {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding-bottom: var(--space-1);
  color: var(--color-primary);
  text-decoration: none;
  border-bottom: 2px solid transparent;
}

.tab[aria-current="page"] {
  color: var(--color-text);
  font-weight: var(--weight-bold);
  border-bottom-color: var(--color-text);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: min(var(--space-5), 5vw);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.itemTitle {
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.empty {
  color: var(--color-text-muted);
}

.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
  gap: var(--space-4);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 32rem;
  padding: min(var(--space-5), 5vw);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.formTitle {
  font-size: var(--text-lg);
}

.levels {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.level {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.levelName {
  overflow-wrap: anywhere;
}

.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
}
```

- [ ] **Step 3b: Write the loading helper**

Create `apps/web/src/setup/useLoad.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import { Button, Notice, Skeleton } from "@/ui";

import type { Loaded } from "./client";
import styles from "./setup.module.css";

export type View<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "failed" | "forbidden" };

/** Loads something now and again on `reload`. Only the newest request may change the screen, so a slow answer never overwrites a newer one. */
export function useLoad<T>(load: () => Promise<Loaded<T>>) {
  const [view, setView] = useState<View<T>>({ status: "loading" });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const result = await load();
    if (mine !== latest.current) return;
    setView(result.ok ? { status: "ready", data: result.data } : { status: result.reason });
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { view, reload };
}

/** What every setup screen shows while it loads, when it fails, and when the person is not allowed. */
export function Gate<T>({ view, onRetry, children }: { view: View<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (view.status === "loading") {
    return (
      <div role="status" aria-busy="true" className={styles.list}>
        <span className="sr-only">{t("setup.loading")}</span>
        {[0, 1, 2].map((n) => (
          <div key={n} className={styles.item} aria-hidden>
            <Skeleton width="55%" height="1.25rem" />
            <Skeleton width="35%" />
          </div>
        ))}
      </div>
    );
  }
  if (view.status === "forbidden") return <Notice tone="bad">{t("setup.forbidden")}</Notice>;
  if (view.status === "failed") {
    return (
      <Notice tone="bad">
        <p>{t("setup.loadFailed")}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t("setup.retry")}
        </Button>
      </Notice>
    );
  }
  return <>{children(view.data)}</>;
}
```

- [ ] **Step 4: Write the layout and sub-menu**

Create `apps/web/src/setup/SetupLayout.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { PortalShell } from "@/shell/PortalShell";

import { termWords } from "./model";
import styles from "./setup.module.css";

/** The four setup screens. Exactly one is marked current; a trailing slash in the address makes no difference. */
export function SetupTabs({ pathname }: { pathname: string }) {
  const { term } = useConfig();
  const words = termWords(term);
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/setup", label: t("setup.tab.years") },
    { href: "/portal/setup/programmes", label: t("setup.tab.programmes", words) },
    { href: "/portal/setup/classes", label: t("setup.tab.classes") },
    { href: "/portal/setup/terminals", label: t("setup.tab.terminals", words) },
  ];

  return (
    <nav aria-label={t("setup.tabs")}>
      <ul className={styles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} className={styles.tab} aria-current={here === tab.href ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The portal frame, the sub-menu, and the screen. Who may see or change what is decided by the API. */
export function SetupLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={styles.page}>
        <SetupTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
```

- [ ] **Step 5: Write the years screen**

Create `apps/web/src/setup/YearsScreen.tsx`:

```tsx
"use client";

import { useCallback, useState, type FormEvent } from "react";

import { BsDateField } from "@/content/BsDateField";
import { formatBsDate } from "@/content/model";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Field, Notice } from "@/ui";

import { activateYear, createYear, loadYears } from "./client";
import { REASON_MESSAGE, YEAR_STATUS_LABEL, canManageInstitution, emptyYearForm, type Year, type YearFormErrors, type YearFormValues } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** The list of years. A draft can be made the current year, but only when no year is current (closing a year is a later phase). */
export function YearsView({ years, canManage, busy, onActivate }: { years: readonly Year[]; canManage: boolean; busy: string | null; onActivate: (year: Year) => void }) {
  if (years.length === 0) return <p className={styles.empty}>{t("setup.years.empty")}</p>;
  const noneCurrent = !years.some((y) => y.status === "active");

  return (
    <ul className={styles.list}>
      {years.map((year) => (
        <li key={year.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{year.label}</h2>
          <div className={styles.badges}>
            <Badge tone={year.status === "active" ? "ok" : "neutral"}>{t(YEAR_STATUS_LABEL[year.status])}</Badge>
          </div>
          <p className={styles.muted}>{t("setup.years.dates", { from: formatBsDate(year.startDateBs), until: formatBsDate(year.endDateBs) })}</p>
          {canManage && noneCurrent && year.status === "draft" ? (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                loading={busy === year.id}
                loadingLabel={t("setup.working")}
                disabled={busy !== null && busy !== year.id}
                aria-label={t("setup.years.activateItem", { label: year.label })}
                onClick={() => onActivate(year)}
              >
                {t("setup.years.activate")}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function YearForm({ onAdded }: { onAdded: () => void }) {
  const { api } = useSession();
  const [values, setValues] = useState<YearFormValues>(emptyYearForm);
  const [errors, setErrors] = useState<YearFormErrors>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem(null);
    const result = await createYear(api, values);
    setSaving(false);
    if (result.ok) {
      setValues(emptyYearForm());
      setErrors({});
      onAdded();
    } else if (result.reason === "fields") {
      setErrors(result.errors);
    } else {
      setErrors({});
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <h2 className={styles.formTitle}>{t("setup.years.add")}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field
        label={t("setup.years.bsYear")}
        hint={t("setup.years.bsYearHint")}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={values.bsYear}
        onChange={(event) => setValues((v) => ({ ...v, bsYear: event.target.value }))}
        error={say(errors.bsYear)}
      />
      <BsDateField legend={t("setup.years.start")} value={values.startBs} onChange={(startBs) => setValues((v) => ({ ...v, startBs }))} error={say(errors.startBs)} />
      <BsDateField legend={t("setup.years.end")} value={values.endBs} onChange={(endBs) => setValues((v) => ({ ...v, endBs }))} error={say(errors.endBs)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.years.add")}
      </Button>
    </form>
  );
}

export function YearsScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const roles = me?.roles ?? [];
  const canManage = canManageInstitution(roles);
  const load = useCallback(() => loadYears(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const coordinator = term("role.coordinator");

  async function activate(year: Year) {
    if (busy) return;
    setBusy(year.id);
    setFlash(null);
    const result = await activateYear(api, year.id);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("setup.saved") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    if (result.ok || result.reason === "another_active") await reload();
  }

  return (
    <>
      <h1 className={styles.title}>{t("setup.years.title")}</h1>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ years }) => <YearsView years={years} canManage={canManage} busy={busy} onActivate={(year) => void activate(year)} />}
      </Gate>
      {canManage ? (
        <YearForm
          onAdded={() => {
            setFlash({ tone: "ok", text: t("setup.saved") });
            void reload();
          }}
        />
      ) : (
        <Notice>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.readOnly", { coordinator })}</Notice>
      )}
    </>
  );
}
```

- [ ] **Step 6: Write the programmes screen**

Create `apps/web/src/setup/ProgrammesScreen.tsx`:

```tsx
"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Field, Notice, Select } from "@/ui";

import { addLevel, createProgramme, loadProgrammes, setLevelActive, setProgrammeActive } from "./client";
import { REASON_MESSAGE, canManageStructure, manageableSections, termWords, type Level, type Programme } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

function LevelAdder({ programme, onAdd }: { programme: Programme; onAdd: (programme: Programme, name: string) => Promise<boolean> }) {
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    const added = await onAdd(programme, name.trim());
    setSaving(false);
    if (added) setName("");
  }

  return (
    <form onSubmit={submit} noValidate className={styles.inline}>
      <Field label={t("setup.programmes.levelName", words)} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} />
      <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.programmes.addLevel", words)}
      </Button>
    </form>
  );
}

export interface ProgrammesViewProps {
  programmes: readonly Programme[];
  canManage: boolean;
  busy: string | null;
  onToggleProgramme: (programme: Programme) => void;
  onToggleLevel: (level: Level, programme: Programme) => void;
  onAddLevel: (programme: Programme, name: string) => Promise<boolean>;
}

/** Each programme with its levels in order. Switching off keeps the history; nothing is deleted. */
export function ProgrammesView({ programmes, canManage, busy, onToggleProgramme, onToggleLevel, onAddLevel }: ProgrammesViewProps) {
  const { term } = useConfig();
  const words = termWords(term);
  if (programmes.length === 0) return <p className={styles.empty}>{t("setup.programmes.empty", words)}</p>;

  return (
    <ul className={styles.list}>
      {programmes.map((programme) => (
        <li key={programme.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{programme.name}</h2>
          <div className={styles.badges}>
            <Badge>{programme.section.name}</Badge>
            <Badge>{programme.affiliation}</Badge>
            {programme.active ? null : <Badge>{t("setup.programmes.off")}</Badge>}
          </div>

          {programme.levels.length === 0 ? (
            <p className={styles.muted}>{t("setup.programmes.noLevels", words)}</p>
          ) : (
            <ul className={styles.levels} aria-label={t("setup.programmes.levelsOf", { ...words, name: programme.name })}>
              {programme.levels.map((level) => (
                <li key={level.id} className={styles.level}>
                  <span className={styles.levelName}>{level.name}</span>
                  {level.active ? null : <Badge>{t("setup.programmes.off")}</Badge>}
                  {canManage ? (
                    <Button
                      variant="quiet"
                      loading={busy === level.id}
                      loadingLabel={t("setup.working")}
                      disabled={busy !== null && busy !== level.id}
                      aria-label={t(level.active ? "setup.programmes.switchOffItem" : "setup.programmes.switchOnItem", { name: level.name })}
                      onClick={() => onToggleLevel(level, programme)}
                    >
                      {t(level.active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <>
              {programme.active ? <LevelAdder programme={programme} onAdd={onAddLevel} /> : null}
              <div className={styles.actions}>
                <Button
                  variant="quiet"
                  loading={busy === programme.id}
                  loadingLabel={t("setup.working")}
                  disabled={busy !== null && busy !== programme.id}
                  aria-label={t(programme.active ? "setup.programmes.switchOffItem" : "setup.programmes.switchOnItem", { name: programme.name })}
                  onClick={() => onToggleProgramme(programme)}
                >
                  {t(programme.active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
                </Button>
              </div>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ProgrammeForm({ sections, onAdded, onProblem }: { sections: readonly { key: string; name: string }[]; onAdded: () => void; onProblem: (key: MessageKey) => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [sectionKey, setSectionKey] = useState(sections.length === 1 ? sections[0]!.key : "");
  const [errors, setErrors] = useState<{ name?: MessageKey; affiliation?: MessageKey; section?: MessageKey }>({});
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key, words) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found: typeof errors = {};
    if (!name.trim()) found.name = "setup.error.nameRequired";
    if (!affiliation.trim()) found.affiliation = "setup.error.affiliationRequired";
    if (!sectionKey) found.section = "setup.error.sectionRequired";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = await createProgramme(api, { name: name.trim(), sectionKey, affiliation: affiliation.trim() });
    setSaving(false);
    if (result.ok) {
      setName("");
      setAffiliation("");
      onAdded();
    } else {
      onProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <h2 className={styles.formTitle}>{t("setup.programmes.add", words)}</h2>
      <Field label={t("setup.programmes.name")} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} error={say(errors.name)} />
      <Select
        label={t("setup.programmes.section", words)}
        value={sectionKey}
        onChange={(event) => setSectionKey(event.target.value)}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...sections.map((s) => ({ value: s.key, label: s.name }))]}
        error={say(errors.section)}
      />
      <Field
        label={t("setup.programmes.affiliation")}
        hint={t("setup.programmes.affiliationHint")}
        value={affiliation}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => setAffiliation(event.target.value)}
        error={say(errors.affiliation)}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.programmes.add", words)}
      </Button>
    </form>
  );
}

export function ProgrammesScreen() {
  const { api, me } = useSession();
  const { config, term } = useConfig();
  const roles = me?.roles ?? [];
  const canManage = canManageStructure(roles);
  const sections = manageableSections(roles, config?.sections ?? []);
  const words = termWords(term);
  const load = useCallback(() => loadProgrammes(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const said = (result: { ok: true } | { ok: false; reason: keyof typeof REASON_MESSAGE }) =>
    setFlash(result.ok ? { tone: "ok", text: t("setup.saved") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });

  async function toggle(id: string, run: () => ReturnType<typeof setProgrammeActive>) {
    if (busy) return;
    setBusy(id);
    setFlash(null);
    const result = await run();
    setBusy(null);
    said(result);
    await reload();
  }

  async function add(programme: Programme, name: string): Promise<boolean> {
    setFlash(null);
    const result = await addLevel(api, programme.id, name);
    said(result);
    if (result.ok) await reload();
    return result.ok;
  }

  return (
    <>
      <h1 className={styles.title}>{t("setup.programmes.title", words)}</h1>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ programmes }) => (
          <ProgrammesView
            programmes={programmes}
            canManage={canManage}
            busy={busy}
            onToggleProgramme={(p) => void toggle(p.id, () => setProgrammeActive(api, p.id, !p.active))}
            onToggleLevel={(l) => void toggle(l.id, () => setLevelActive(api, l.id, !l.active))}
            onAddLevel={add}
          />
        )}
      </Gate>
      {canManage && sections.length > 0 ? (
        <ProgrammeForm
          sections={sections}
          onAdded={() => {
            setFlash({ tone: "ok", text: t("setup.saved") });
            void reload();
          }}
          onProblem={(key) => setFlash({ tone: "bad", text: t(key) })}
        />
      ) : null}
      {canManage ? null : <Notice>{t("setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </>
  );
}
```

- [ ] **Step 7: Write the classes screen**

Create `apps/web/src/setup/ClassesScreen.tsx`:

```tsx
"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Field, Notice, Select } from "@/ui";

import { createClass, loadClasses, loadProgrammes, loadYears, setClassActive, type Loaded } from "./client";
import { REASON_MESSAGE, canManageStructure, classTitle, defaultYearId, levelChoices, termWords, type Programme, type SchoolClass, type Year } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** Picks the year a screen is about. Shared by the classes and terminals screens. */
export function YearPicker({ years, value, onChange }: { years: readonly Year[]; value: string | null; onChange: (id: string) => void }) {
  return <Select label={t("setup.yearPicker")} value={value ?? ""} onChange={(event) => onChange(event.target.value)} options={years.map((y) => ({ value: y.id, label: y.label }))} />;
}

/** The classes of the chosen year. Switching one off keeps its history. */
export function ClassesView({ classes, canManage, busy, onToggle }: { classes: readonly SchoolClass[]; canManage: boolean; busy: string | null; onToggle: (c: SchoolClass) => void }) {
  if (classes.length === 0) return <p className={styles.empty}>{t("setup.classes.empty")}</p>;
  return (
    <ul className={styles.list}>
      {classes.map((c) => {
        const title = classTitle(c);
        return (
          <li key={c.id} className={styles.item}>
            <h2 className={styles.itemTitle}>{title}</h2>
            {c.active ? null : (
              <div className={styles.badges}>
                <Badge>{t("setup.classes.off")}</Badge>
              </div>
            )}
            {canManage ? (
              <div className={styles.actions}>
                <Button
                  variant="quiet"
                  loading={busy === c.id}
                  loadingLabel={t("setup.working")}
                  disabled={busy !== null && busy !== c.id}
                  aria-label={t(c.active ? "setup.classes.switchOffItem" : "setup.classes.switchOnItem", { name: title })}
                  onClick={() => onToggle(c)}
                >
                  {t(c.active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ClassForm({ yearId, programmes, onAdded }: { yearId: string; programmes: readonly Programme[]; onAdded: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [levelId, setLevelId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    if (!levelId) {
      setError("setup.error.levelRequired");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createClass(api, { yearId, levelId, label: label.trim() });
    setSaving(false);
    if (result.ok) {
      setLabel("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <h2 className={styles.formTitle}>{t("setup.classes.add")}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Select
        label={t("setup.classes.level", words)}
        value={levelId}
        onChange={(event) => setLevelId(event.target.value)}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...levelChoices(programmes)]}
        error={error ? t(error, words) : undefined}
      />
      <Field label={t("setup.classes.label")} hint={t("setup.classes.labelHint")} value={label} maxLength={40} autoComplete="off" onChange={(event) => setLabel(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.classes.add")}
      </Button>
    </form>
  );
}

export function ClassesScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const canManage = canManageStructure(me?.roles ?? []);
  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const loadProgrammesNow = useCallback(() => loadProgrammes(api), [api]);
  const years = useLoad(loadYearsNow);
  const programmes = useLoad(loadProgrammesNow);
  const [picked, setPicked] = useState<string | null>(null);
  const yearId = picked ?? (years.view.status === "ready" ? defaultYearId(years.view.data.years) : null);
  const loadClassesNow = useCallback(
    (): Promise<Loaded<{ classes: SchoolClass[] }>> => (yearId ? loadClasses(api, yearId) : Promise.resolve({ ok: true, data: { classes: [] } })),
    [api, yearId],
  );
  const classes = useLoad(loadClassesNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(c: SchoolClass) {
    if (busy) return;
    setBusy(c.id);
    setFlash(null);
    const result = await setClassActive(api, c.id, !c.active);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("setup.saved") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await classes.reload();
  }

  return (
    <>
      <h1 className={styles.title}>{t("setup.classes.title")}</h1>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={styles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={styles.filters}>
                <YearPicker years={list} value={yearId} onChange={setPicked} />
              </div>
              <Gate view={classes.view} onRetry={() => void classes.reload()}>
                {(data) => <ClassesView classes={data.classes} canManage={canManage} busy={busy} onToggle={(c) => void toggle(c)} />}
              </Gate>
              {canManage && yearId && programmes.view.status === "ready" ? (
                <ClassForm
                  yearId={yearId}
                  programmes={programmes.view.data.programmes}
                  onAdded={() => {
                    setFlash({ tone: "ok", text: t("setup.saved") });
                    void classes.reload();
                  }}
                />
              ) : null}
            </>
          )
        }
      </Gate>
      {canManage ? null : <Notice>{t("setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </>
  );
}
```

- [ ] **Step 8: Write the terminals screen**

Create `apps/web/src/setup/TerminalsScreen.tsx`:

```tsx
"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Field, Notice } from "@/ui";

import { YearPicker } from "./ClassesScreen";
import { createTerminal, loadTerminals, loadYears, type Loaded } from "./client";
import { REASON_MESSAGE, canManageInstitution, defaultYearId, termWords, type Terminal } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

/** The terminals of the chosen year, in order. The school's own word for a terminal is used throughout. */
export function TerminalsView({ terminals }: { terminals: readonly Terminal[] }) {
  const { term } = useConfig();
  const words = termWords(term);
  if (terminals.length === 0) return <p className={styles.empty}>{t("setup.terminals.empty", words)}</p>;
  return (
    <ul className={styles.list}>
      {terminals.map((terminal) => (
        <li key={terminal.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{terminal.name}</h2>
          <p className={styles.muted}>{t("setup.terminals.number", { n: terminal.ordinal })}</p>
        </li>
      ))}
    </ul>
  );
}

function TerminalForm({ yearId, onAdded }: { yearId: string; onAdded: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    if (!name.trim()) {
      setError("setup.error.nameRequired");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createTerminal(api, { yearId, name: name.trim() });
    setSaving(false);
    if (result.ok) {
      setName("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <h2 className={styles.formTitle}>{t("setup.terminals.add", words)}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field label={t("setup.terminals.name")} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} error={error ? t(error) : undefined} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.terminals.add", words)}
      </Button>
    </form>
  );
}

export function TerminalsScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const roles = me?.roles ?? [];
  const canManage = canManageInstitution(roles);
  const words = termWords(term);
  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const years = useLoad(loadYearsNow);
  const [picked, setPicked] = useState<string | null>(null);
  const yearId = picked ?? (years.view.status === "ready" ? defaultYearId(years.view.data.years) : null);
  const loadTerminalsNow = useCallback(
    (): Promise<Loaded<{ terminals: Terminal[] }>> => (yearId ? loadTerminals(api, yearId) : Promise.resolve({ ok: true, data: { terminals: [] } })),
    [api, yearId],
  );
  const terminals = useLoad(loadTerminalsNow);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <h1 className={styles.title}>{t("setup.terminals.title", words)}</h1>
      {saved ? <Notice tone="ok">{t("setup.saved")}</Notice> : null}
      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={styles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={styles.filters}>
                <YearPicker
                  years={list}
                  value={yearId}
                  onChange={(id) => {
                    setSaved(false);
                    setPicked(id);
                  }}
                />
              </div>
              <Gate view={terminals.view} onRetry={() => void terminals.reload()}>
                {(data) => <TerminalsView terminals={data.terminals} />}
              </Gate>
              {canManage && yearId ? (
                <TerminalForm
                  yearId={yearId}
                  onAdded={() => {
                    setSaved(true);
                    void terminals.reload();
                  }}
                />
              ) : null}
            </>
          )
        }
      </Gate>
      {canManage ? null : <Notice>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </>
  );
}
```

- [ ] **Step 9: Write the four pages**

Create `apps/web/src/app/portal/setup/page.tsx`:

```tsx
"use client";

import { SetupLayout } from "@/setup/SetupLayout";
import { YearsScreen } from "@/setup/YearsScreen";

/** Setup, starting with the academic years. Who may see or change what is decided by the API; the menu entry is only tidiness. */
export default function SetupPage() {
  return (
    <SetupLayout>
      <YearsScreen />
    </SetupLayout>
  );
}
```

Create `apps/web/src/app/portal/setup/programmes/page.tsx`:

```tsx
"use client";

import { ProgrammesScreen } from "@/setup/ProgrammesScreen";
import { SetupLayout } from "@/setup/SetupLayout";

export default function ProgrammesPage() {
  return (
    <SetupLayout>
      <ProgrammesScreen />
    </SetupLayout>
  );
}
```

Create `apps/web/src/app/portal/setup/classes/page.tsx`:

```tsx
"use client";

import { ClassesScreen } from "@/setup/ClassesScreen";
import { SetupLayout } from "@/setup/SetupLayout";

export default function ClassesPage() {
  return (
    <SetupLayout>
      <ClassesScreen />
    </SetupLayout>
  );
}
```

Create `apps/web/src/app/portal/setup/terminals/page.tsx`:

```tsx
"use client";

import { SetupLayout } from "@/setup/SetupLayout";
import { TerminalsScreen } from "@/setup/TerminalsScreen";

export default function TerminalsPage() {
  return (
    <SetupLayout>
      <TerminalsScreen />
    </SetupLayout>
  );
}
```

- [ ] **Step 10: Add the menu entry, and give the new pages a budget setting**

In `apps/web/src/shell/nav.ts`, replace the single line

```ts
  { id: "content", labelKey: "nav.content", href: "/portal/content", roles: ["admin", "super_admin"] },
```

with:

```ts
  { id: "content", labelKey: "nav.content", href: "/portal/content", roles: ["admin", "super_admin"] },
  // Phase 3: the academic structure. The Co-ordinator sets it up; the Admin can look (the API decides, D-025).
  { id: "setup", labelKey: "nav.setup", href: "/portal/setup", roles: ["coordinator", "admin", "super_admin"] },
```

In `apps/web/test/nav.test.ts`, make these four single-line edits inside the `the real menu` test:

1. `  it("shows the Admin and the Super Admin the website entry, and no one else", () => {` becomes `  it("shows each role its own entries: website for the Admin, setup for the Co-ordinator and the Admin", () => {`
2. `    expect(seen("admin", "institution")).toEqual(["dashboard", "content"]);` becomes `    expect(seen("admin", "institution")).toEqual(["dashboard", "content", "setup"]);`
3. `    expect(seen("super_admin", "institution")).toEqual(["dashboard", "content"]);` becomes `    expect(seen("super_admin", "institution")).toEqual(["dashboard", "content", "setup"]);\n    expect(seen("coordinator", "institution")).toEqual(["dashboard", "setup"]);\n    expect(seen("coordinator", "section")).toEqual(["dashboard", "setup"]);`
4. The line beginning `    for (const [role, scope] of [["student", "own"], ["teacher", "assigned"], ["coordinator", "institution"], ["accountant", "institution"]] as const) {` becomes the same line without `["coordinator", "institution"], `.

(`seen` takes `"institution" | "own" | "assigned"`; widen its parameter type to include `"section"`: change `(role: string, scope: "institution" | "own" | "assigned")` to `(role: string, scope: "institution" | "section" | "own" | "assigned")`.)

In `apps/web/page-weight-budget.json`, the `ignore` list gains the four new portal pages (a page in the build but in neither list fails the build): change the line

```json
  "ignore": ["404", "_not-found", "design", "portal", "portal/content", "portal/content/edit"],
```

to

```json
  "ignore": ["404", "_not-found", "design", "portal", "portal/content", "portal/content/edit", "portal/setup", "portal/setup/programmes", "portal/setup/classes", "portal/setup/terminals"],
```

- [ ] **Step 11: Run to verify it passes**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.test.json && npx eslint`
Expected: PASS everywhere, including `guards.test.ts` (no colour, font or literal words outside the theme and catalog). If `guards.test.ts` flags a literal word in a component, move it into `messages.ts`; if it flags a colour, use a token. If a `react-hooks` lint rule flags `setState` inside an effect in `useLoad`, keep the pattern (the existing `ContentList` does the same) and add a one-line `// eslint-disable-next-line` with the rule name and the reason.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src apps/web/test apps/web/page-weight-budget.json
git commit -m "Slice 1: the Setup screens (years, programmes, classes, terminals)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: See it work, and review the design

**Files:** none created (fixes go where the problems are). Findings go into the D-057 entry in Task 11.

- [ ] **Step 1: Get a local school to look at**

Stop nothing that is running. In `apps/api`:

```bash
npm run provision -- --pack ../../packs/royal-softech --local
USER_PASSWORD='a-long-throwaway-passphrase-2083' npm run dev:user -- --email setup-tester@school.example --name "Setup Tester" --role coordinator
```

Expected: the second command prints that the account was created. (This is a local test account with a throwaway password. Never sign the PM's own local account out and never type its credentials: use the address `http://127.0.0.1:3000`, which has its own cookies, separate from the PM's `http://localhost:3000` session.)

- [ ] **Step 2: Start the app and check the flow**

Start the servers with the preview tools (`preview_start` for `worker`, then `web-dev`; never Bash). If `apps/web/out` is locked or stale, the `web-dev` server (port 3000) is enough: it forwards `/api` to the Worker. Open `http://127.0.0.1:3000/sign-in` in the built-in browser and sign in as `setup-tester@school.example` with the throwaway password. Then check, using `read_page`, `find`, `computer` and `read_console_messages`:

1. The menu shows Setup; open it. Add a year (BS 2083; first day Baisakh 1, last day Chaitra 30), see it listed as "Not started", make it current, see "Current year".
2. Programmes: the two sample programmes are there with their levels; add a programme and a level; switch a level off and on.
3. Classes: pick the year, add a class for a level with the label Morning, add the same again (see "That already exists."), switch one off.
4. Terminals: add two; they read Number 1, Number 2.
5. No console errors. A wrong action shows a plain message, not a blank screen.

Expected: every step works and every message is in plain words. Fix what does not, by editing the source (never with the console).

- [ ] **Step 3: Check the small-screen and text-size rules**

With `resize_window` set to 320 px wide (mobile emulation) and text enlarged (`document.documentElement.style.fontSize = '200%'` in `javascript_tool`), open each of the four screens and check: no sideways page scroll (compare list elements to the real width, not `scrollWidth` to `innerWidth`), no mid-word breaks, controls at least 44 px tall (`getBoundingClientRect` on the buttons and the tab links). Then check dark appearance with `resize_window` `colorScheme: "dark"`. Reset the viewport to `desktop` when done. Take a screenshot of the Years and Programmes screens as proof.

- [ ] **Step 4: Review as the Admin and as a section-scoped Co-ordinator**

The Admin: use the PM's already-signed-in local session at `http://localhost:3000/portal/setup` only to look (do not sign in or out): every screen loads, no add form or switch buttons show, and the note says only a Co-ordinator can change it. Create a +2-only Co-ordinator (`USER_PASSWORD=... npm run dev:user -- --email plus2-tester@school.example --name "Plus2 Tester" --role coordinator --scope section:plus2`) and sign in as them at `http://127.0.0.1:3000` (after signing the first tester out): Programmes shows only the +2 programme and the form offers only the +2 section; Years and Terminals show the "whole school" note and no form.

- [ ] **Step 5: Run the `apple-design` review**

Load the `apple-design` skill (`.claude/skills/apple-design/`; if it is missing, stop and ask the PM before continuing UI work, per `CLAUDE.md`). Read its always-load pages (accessibility, layout, typography, colour) and the pages for what is on screen (forms and text fields, lists and tables, navigation and tabs, buttons, feedback and errors). Read a page before citing it. Review the four screens against the house rules from D-030 (one prominent button per view; brand colour means "you can act on this"; controls at least 44 px; 320 px and 200% text; a menu of one entry is not shown; show the shape of a page while it loads). Fix every finding that is a defect in this slice. Record for the final report: what was checked, which pages were used (`file.md › Heading`), what was fixed, what was left and why.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "Slice 1: fixes from the browser check and the design review" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(If nothing changed, skip the commit.)

---

### Task 11: Prove the tests bite, replay CI clean, log it, and open the pull request

**Files:**
- Modify: `docs/data-model.md`, `docs/DECISIONS.md`, `docs/build-plan.md`, `CLAUDE.md` (status lines)

- [ ] **Step 1: Break the code on purpose (each break must make a named test fail)**

For each row: make the change, run the test, confirm it FAILS, then undo the change (`git checkout -- <file>`). Record the result of every row for the report.

| # | Break | Run | Must fail |
|---|---|---|---|
| 1 | `guard.ts`: change `ga.scope_type = 'institution' OR ga.section_id = ${sectionId}` to `1 = 1` | `npx vitest run test/academics-programmes.test.ts test/academics-routes.test.ts` | "may create only in their own section"; "cannot change the other section's" |
| 2 | `guard.ts`: remove `AND gu.is_active = 1` in `coordinatorForInstitution` | `npx vitest run test/academics-years.test.ts` | "re-checks the person in the database" |
| 3 | `classes.ts` `createClass`: delete `AND l.is_active = 1 AND p.is_active = 1` from the INSERT | `npx vitest run test/academics-classes.test.ts` | "refuses an unknown year or level, an inactive level, and a closed year" |
| 4 | `0009` migration: delete the `classes_year_open_insert` trigger | `npx vitest run test/academics-schema.test.ts` | "a closed year refuses a new class, a change, and a removal, whatever the service does" (the API tests still pass: the service guard is the second guard) |
| 4b | Both closed-year guards on class creation: delete that trigger AND `y.status <> 'closed' AND` in `createClass` | `npx vitest run test/academics-classes.test.ts test/academics-routes.test.ts` | "refuses ... a closed year" and the route test's `409 year_closed` (a class is made in a closed year). This proves the two guards each cover for the other |
| 5 | `0009` migration: delete the `CREATE UNIQUE INDEX academic_years_one_active ...` statement, and in `years.ts` `activateYear` delete the `AND NOT EXISTS (SELECT 1 FROM academic_years WHERE status = 'active')` line | `npx vitest run test/academics-schema.test.ts test/academics-years.test.ts` | "allows only one active year"; the activation race test |
| 6 | `queries.ts` `listProgrammes`: delete the `WHERE (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))` line | `npx vitest run test/academics-routes.test.ts` | "lists only their own section's programmes and classes" |
| 7 | `pack.ts`: change `ON CONFLICT (key) DO NOTHING` to `ON CONFLICT (key) DO UPDATE SET name = excluded.name` | `npx vitest run test/academics-pack.test.ts` | "never overwrites what the Co-ordinator changed on a screen" |
| 8 | `write.ts`: change `{ onlyIfLastChanged: true }` to `{}` | `npx vitest run test/academics-years.test.ts test/academics-classes.test.ts` | the "no false audit entry" cases |
| 9 | `SetupLayout.tsx`: delete `aria-current=...` | `cd apps/web && npx vitest run test/setup-screens.test.tsx` | "marks exactly the current one" |

If a break does NOT make a test fail, the test is too weak: strengthen it, then repeat the break.

- [ ] **Step 2: Replay CI in a fresh clone (local leftovers hide CI failures)**

Push the branch first: `git push -u origin phase3-slice1-structure`. Then, in the scratchpad directory, clone the pushed commit fresh and run the workflow's steps exactly:

```bash
git clone --branch phase3-slice1-structure https://github.com/krishav0301/krishav0301-school-platform.git ci-replay
cd ci-replay/apps/api
node ../../scripts/check-no-bom.mjs
node ../../scripts/check-boundaries.mjs
npm ci
npm run typecheck
npm run lint
npm test
npm run gen:permissions && git diff --exit-code ../../docs/permission-matrix.md
npm run gen:openapi && git diff --exit-code openapi.json
cd ../web
npm ci
(cd ../api && npm ci)
npm run gen:api && git diff --exit-code src/api/schema.d.ts
npm run typecheck
npm run lint
npm test
npm run build
node ../../scripts/check-page-weight.mjs --out out --budget page-weight-budget.json
```

Expected: every command exits 0. Fix and re-push on any failure, then repeat from a fresh clone. (`npm run typecheck` in `apps/api` runs `wrangler types`, which is fine in a throwaway clone.)

- [ ] **Step 3: Update `docs/data-model.md`**

In the Phase 3 table, replace the `Programme`, `Level`, `Class` and `Terminal` rows' details with what was built, and note the two differences from the sketch: (1) `Class` has no `class_teacher` yet (slice 3), and `label` is `''` instead of null so the uniqueness rule works; (2) `SubjectOffering` attaches to a programme level, not a class (slice 2, D-056). Read the file first and edit only those rows and one sentence under the table.

- [ ] **Step 4: Write D-057 in `docs/DECISIONS.md`**

Append after the D-056 block (before "## Open items carried forward"): **D-057 Phase 3 slice 1: academic structure.** Date, the PM's yes (design in chat, "yes", 2026-09-21). Content: what was built (five tables, `academics` module, 14 routes, the pack block, four screens); the rules chosen while building: years and terminals are institution-level (a section-scoped Co-ordinator can only view), the Admin views read-only, the class label is `''` not null, programme keys generated for screen-made programmes, activation refused while another year is active, the closed-year rule is in both the service and triggers; what was tested (list the test files and counts from the last run) and the mutation checks (the nine rows and their results); the `ui-ux-pro-max` searches used and the `apple-design` review (pages used, fixed, left); what is not done (renaming and date edits in the screens; only the API supports them; Class Teacher, subjects, people, approvals are slices 2 to 4; closing a year is Phase 8); `OPEN:` the Royal programme and level list is a placeholder.

- [ ] **Step 5: Update the status lines**

In `docs/build-plan.md`, in the "Start Phase 3 here (next session)" paragraph, replace its text with a short "Phase 3 progress" paragraph: slice 1 built (D-057), slices 2 to 5 next. In `CLAUDE.md`, change the "Current phase" line's parenthesis to say "slice 1 (structure) built (D-057); slice 2 (subjects) next". Anchor each edit on a single line.

- [ ] **Step 6: Commit, push, open the pull request, and read CI**

```bash
git add -A
git commit -m "D-057: Phase 3 slice 1 (academic structure), data model and status" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```

Open the pull request with `gh` (`C:\Program Files\GitHub CLI\gh.exe`): title "Phase 3, slice 1: academic structure (years, programmes, classes, terminals)"; body: what changed, what was tested, what is not done, the `OPEN:` items, the permission and audit note at the top (it adds a permission row, writes audit entries, and adds a role check in every write), and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Bind it with `mcp__ccd_pr__bind_pr`, read CI with `get_status` (the API job takes 8 to 10 minutes). Merge only when CI shows 6 of 6 on the head commit and the passing checks ran on the latest commit (compare the PR head with the local head), with a merge commit, and delete the branch. If the PM said to wait for a go-ahead, wait.

- [ ] **Step 7: After the merge, provision staging (the PM deploys)**

For an existing school, provision first, then deploy. Run: `cd apps/api && npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.local.jsonc` (applies migration 0009 and seeds the two sample programmes on staging). Then tell the PM to deploy in their own PowerShell: `cd apps\api` then `npx wrangler deploy --config wrangler.local.jsonc`. Rebuild `apps/web/out` first (in a fresh clone if a `wrangler dev` holds the folder). After the deploy, check with curl that `/portal/setup/` returns 200 and `/api/academics/years` returns 401 when signed out.

---

## Self-review (done when writing this plan)

**Spec coverage (spec section 4, slice 1):** tables and rules (Task 1); permission row (2); years, programmes and levels, classes, terminals with scope, audit, closed-year, verified BS years (3 to 5); API and matrix (6); pack block, placeholders, second school (7); screens with words, tokens, 320 px, Admin read-only (8, 9, 10); tests including independent permission rules, section cross-scope, failure paths, mutation checks (1 to 7, 11). Decisions D-056 and the new rule that years and terminals are institution-level are logged in D-057 (Task 11).

**Not covered on purpose (listed in D-057):** renaming programmes and editing a draft year's dates in the screens (the API supports both); Class Teacher (slice 3); subjects and electives (slice 2); approvals (slice 4); the checklist (slice 5).

**Names checked across tasks:** `coordinatorForSection`/`coordinatorForInstitution` (guard) used by years, programmes, classes; `write` outcomes `done|not_applied|duplicate|year_closed|check_failed` used consistently; `Failure.reason` values match the route `fail()` mapping and the web `reasonOf`/`FailReason`; response schema names `AcademicYear`, `Programme`, `Level`, `SchoolClass`, `Terminal` match `model.ts`.
