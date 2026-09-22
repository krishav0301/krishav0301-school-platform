# Phase 3, Slice 5: Checklist and Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Co-ordinator's dashboard shows what is left to set up, each item linking to its screen; a `phase3-exit.test.ts` runs the whole academic-setup-to-approval flow through the real API, for both packs, the same shape as `phase2-exit.test.ts`. This is the last slice of Phase 3.

**Architecture:** one new read, `getSetupChecklist`, added to `academics/queries.ts` (six of seven items are academics-owned data; the seventh, "a teacher exists", queries the core `users`/`role_assignments` tables the same way `academics/guard.ts` already does for its own guards — not a new boundary crossing). A new route reuses the existing `setup.structure.view` permission; no new matrix row. The web dashboard gets a checklist component, Co-ordinator only. The exit test is a new file, not new product code.

**Tech Stack:** Cloudflare Workers, Hono with `@hono/zod-openapi`, D1, Next.js static export.

**Spec:** `docs/superpowers/specs/2026-09-21-phase3-academic-setup-design.md`, section 8 (outline) and the chat design approved 2026-09-22 ("go ahead"). Decision to log: D-062.

## Global Constraints

- Everything in slices 1–4's Global Constraints still holds.
- **Nothing is stored for the checklist.** It is computed fresh on every read, one round trip.
- **Words stay in `messages.ts`.** The API returns booleans keyed by item; the web side owns each item's label and link.
- **The checklist is Co-ordinator-only** on the dashboard (an open choice, not specified by the design; flagged, not decided silently — the Admin's dashboard is unchanged).
- Branch `phase3-slice5-checklist-exit`.

## Tasks

### Task 1: `getSetupChecklist` and its schema
Files: `apps/api/src/modules/academics/schema.ts` (add `SetupChecklistSchema`), `apps/api/src/modules/academics/queries.ts` (add `getSetupChecklist`).

```ts
// schema.ts, added
export const SetupChecklistSchema = z
  .object({
    year: z.boolean(),
    structure: z.boolean(),
    classes: z.boolean(),
    terminals: z.boolean(),
    subjects: z.boolean(),
    teachers: z.boolean(),
    classTeachers: z.boolean(),
  })
  .openapi("SetupChecklist");
export type SetupChecklist = z.infer<typeof SetupChecklistSchema>;
```

```ts
// queries.ts, added
/**
 * A Co-ordinator's setup checklist (D-062): nothing is stored, this is computed fresh from the data,
 * scoped to the sections the viewer may see. One round trip: each item is a single EXISTS/NOT EXISTS
 * subquery bound to the active year (most items depend on there being one at all).
 */
export async function getSetupChecklist(db: D1Database, sections: "all" | readonly string[]): Promise<SetupChecklist> {
  const filter = sectionFilter(sections);
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM academic_years WHERE status = 'active') AS year,
         EXISTS (SELECT 1 FROM programmes p JOIN sections s ON s.id = p.section_id
                  WHERE p.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
                    AND EXISTS (SELECT 1 FROM levels l WHERE l.programme_id = p.id AND l.is_active = 1)) AS structure,
         EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                  JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                  WHERE y.status = 'active' AND c.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS classes,
         EXISTS (SELECT 1 FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.status = 'active') AS terminals,
         EXISTS (SELECT 1 FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN programmes p ON p.id = l.programme_id
                  JOIN sections s ON s.id = p.section_id
                  WHERE o.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS subjects,
         EXISTS (SELECT 1 FROM users u JOIN role_assignments ra ON ra.user_id = u.id
                  WHERE u.is_active = 1 AND ra.is_active = 1 AND ra.role = 'teacher') AS teachers,
         NOT EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                      JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                      WHERE y.status = 'active' AND c.is_active = 1 AND c.class_teacher_user_id IS NULL
                        AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))))
                AND EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                      JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                      WHERE y.status = 'active' AND c.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS classTeachers`,
    )
    .bind(filter)
    .first<Record<string, number>>();
  const r = row!;
  return { year: r.year === 1, structure: r.structure === 1, classes: r.classes === 1, terminals: r.terminals === 1, subjects: r.subjects === 1, teachers: r.teachers === 1, classTeachers: r.classTeachers === 1 };
}
```
Note: `classTeachers` is "every active class in the active year (within the viewer's sections) has a Class Teacher, **and** at least one such class exists" — an empty set is not "done" (nothing to nudge about yet, not a false positive). `teachers` is intentionally not section-filtered: a Co-ordinator's checklist item is "does the school have any teacher at all", not "in my section", since a section-scoped Co-ordinator might reasonably rely on a whole-school Co-ordinator having added them.

Test first (`apps/api/test/setup-checklist.test.ts`, copy `teaching-schema.test.ts`'s raw-SQL seeding style): each item false on an empty database in turn becomes true only once its own condition is met (build up state step by step: no year → active year → programme+level with no class → a class → a terminal → an offering → a teacher → a class with a Class Teacher on every active class); a switched-off programme/level/class/offering does not count; a class in a **closed** year does not count (the query filters on `status = 'active'`, not merely "any year"); a section-scoped viewer sees `structure`/`classes`/`subjects` computed only from their own section, but `year`/`terminals`/`teachers` unaffected by section (they are whole-school facts); `classTeachers` is `false` when there are active classes but not all have one, and `true` once every active class does.

- [ ] Write the failing tests above.
- [ ] Run: `cd apps/api && npx vitest run test/setup-checklist.test.ts` — expect FAIL (function does not exist).
- [ ] Add `SetupChecklistSchema` and `getSetupChecklist` as above.
- [ ] Run again — expect PASS.
- [ ] Commit: `git add apps/api/src/modules/academics/schema.ts apps/api/src/modules/academics/queries.ts apps/api/test/setup-checklist.test.ts && git commit -m "Slice 5: the setup checklist, computed fresh"`.

### Task 2: The route and the contract
File: `apps/api/src/modules/academics/routes.ts` (add one route), `apps/api/src/modules/academics/index.ts` (export `getSetupChecklist`/`SetupChecklist` if any other module needs them — none does yet, so this is only needed if a test imports through `service`/`index`; check first, add only if needed).

```ts
defineRoute(
  app,
  {
    method: "get",
    path: "/api/academics/checklist",
    operationId: "get_setup_checklist",
    tags: ["academics"],
    description: "A Co-ordinator's setup checklist: what is done and what is left, computed fresh each time. Nothing is stored.",
    access: VIEW, // setup.structure.view, already declared above in this file
    responses: { 200: { description: "The checklist", content: json(SetupChecklistSchema) } },
  },
  async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await getSetupChecklist(c.env.DB, allowedSections(c.get("grant")!)), 200);
  },
);
```

Test first (`apps/api/test/setup-checklist-routes.test.ts`, copy `academics-routes.test.ts`'s harness): 401 signed out; 403 for Student, Teacher, Accountant; 200 for Co-ordinator (both scopes) and Super Admin; the Admin may read (per `setup.structure.view`'s existing `read` cell) but there is nothing to write, so no write test is needed; `no-store`; a section-scoped Co-ordinator's `structure`/`classes`/`subjects` reflect only their section (seed both sections differently and assert the difference).

- [ ] Write the failing route test.
- [ ] Run: `cd apps/api && npx vitest run test/setup-checklist-routes.test.ts` — expect FAIL.
- [ ] Add the route.
- [ ] Run again — expect PASS.
- [ ] Run `npm run gen:openapi` (from `apps/api`), `npm run gen:api` (from `apps/web`), the full API suite, `node scripts/check-boundaries.mjs` (root).
- [ ] Commit: `git add apps/api/src/modules/academics/routes.ts apps/api/openapi.json apps/web/src/api/schema.d.ts apps/api/test/setup-checklist-routes.test.ts && git commit -m "Slice 5: the checklist route and the regenerated contract"`.

### Task 3: The dashboard checklist
Files: `apps/web/src/setup/ChecklistCard.tsx` (new; lives under `setup/` since it reads academics data, mirroring how `people/teaching-*` lived under `people/` for a People-area concern), `apps/web/src/setup/checklist-client.ts` (new, tiny), `apps/web/src/app/portal/page.tsx` (render it for a Co-ordinator), `apps/web/src/i18n/messages.ts`.

```ts
// setup/checklist-client.ts
import type { ApiClient } from "@/api/client";
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type Checklist = import("@/api/schema").components["schemas"]["SetupChecklist"];
export async function loadChecklist(api: ApiClient): Promise<Loaded<Checklist>> {
  try {
    const { data, response } = await api.GET("/api/academics/checklist");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
```

`ChecklistCard.tsx`: a `Card` (matching the dashboard's existing `Card` for "Roles") listing seven items in a fixed order, each a `Link` to its screen, with a done/not-done indicator (a `Badge`, reusing the pattern already used elsewhere rather than inventing a checkmark icon — this app's icon-free, badge-based convention). Order and hrefs: year → `/portal/setup`, structure → `/portal/setup/programmes`, classes → `/portal/setup/classes`, terminals → `/portal/setup/terminals`, subjects → `/portal/setup/curriculum`, teachers → `/portal/people`, classTeachers → `/portal/people/teaching`.

Message keys: `portal.checklist.title`, `.year`, `.structure`, `.classes`, `.terminals`, `.subjects`, `.teachers`, `.classTeachers`, `.done`, `.notDone`, `.loadFailed`, `.forbidden`.

Test first (`apps/web/test/checklist-screens.test.tsx`, copy `teaching-screens.test.tsx`'s harness): all seven items render with their labels and links, in the fixed order; a done item is marked done, a not-done item is not; the card does not render at all for an Admin or Super Admin (Co-ordinator only, per the design's open choice); the loading shape.

- [ ] Write the failing test.
- [ ] Run: `cd apps/web && npx vitest run test/checklist-screens.test.tsx` — expect FAIL.
- [ ] Add the message keys, `checklist-client.ts`, `ChecklistCard.tsx`, and render it in `portal/page.tsx` for a Co-ordinator only (replacing the "Nothing yet" note for that role; the Admin/Super Admin keep seeing it, since nothing else fills their dashboard yet).
- [ ] Run again — expect PASS.
- [ ] Run `cd apps/web && npx vitest run` (full suite: `guards.test.ts`, page-weight — the dashboard `/portal` route is already in the ignore list, check first) and lint/typecheck.
- [ ] Commit: `git add apps/web/src/setup/ChecklistCard.tsx apps/web/src/setup/checklist-client.ts apps/web/src/app/portal/page.tsx apps/web/src/i18n/messages.ts apps/web/test/checklist-screens.test.tsx && git commit -m "Slice 5: the Co-ordinator's setup checklist on the dashboard"`.

### Task 4: The Phase 3 exit check
File: `apps/api/test/phase3-exit.test.ts` (new), copying `phase2-exit.test.ts`'s shape closely: `describe.each` over both packs (Royal Softech → `env.DB`, Sample Basic School → `env.SCRATCH_DB`), through the real HTTP API (`createApp()`, `app.request`), each school building on its own pack (already seeded with programmes and levels by `applyPack`, so structure only needs a year, a class and a terminal, not new programmes).

Sequence per school (one `describe.each` block, `it`s run in order since each depends on the last, matching `phase2-exit.test.ts`'s own style of accumulating state across `it`s within a `describe`):
1. `applyPack`; sign in (craft tokens directly, as `phase2-exit.test.ts` does, for admin/coordinator/teacher/student/accountant) except for **one** teacher, created through the real `POST /api/teachers` + first-password flow (`POST /api/auth/sign-in` with the temporary password → `passwordChange: "required"` → `POST /api/auth/password/change-required` → a session), to prove that path still works end to end at the close of Phase 3.
2. Structure: `POST /api/academics/years` (a fresh verified BS year), `POST /api/academics/classes` (using a level from the pack), `POST /api/academics/terminals`. Assert `GET /api/academics/checklist` shows `year`, `classes`, `terminals` true and `subjects`, `teachers`, `classTeachers` still false (bar the pre-existing programme/level structure, which is already true from the pack — assert `structure` true from the start).
3. Subjects: `POST /api/academics/subjects`, `POST /api/academics/offerings` on the new class's level. Checklist `subjects` now true.
4. Teaching: `POST /api/academics/assignments` (the offering, the class, the real teacher from step 1), `POST /api/academics/classes/{id}/class-teacher`. Checklist `teachers` and `classTeachers` now true — **every** item is true.
5. Approvals: the Co-ordinator drafts a notice (`POST /api/content`), sends it for approval (`POST /api/approvals`), the Admin approves it (`POST /api/approvals/{id}/approve`); assert the item is `live` on `GET /api/site/content`.
6. Permissions: a Student and a Teacher (not the Co-ordinator or Admin) are refused at one representative write in each area (a class, an offering, an assignment, a content draft, a decide) — not exhaustive (that is what the per-slice permission tests already are), just proof the exit gate would fail if a guard were removed.
7. The audit log is one unbroken chain (`verifyAuditChain`), same as `phase2-exit.test.ts`'s last check.

- [ ] Write the test file in full (it is the deliverable of this task; no separate "make it pass" step in the usual tests-first sense, since there is no new product code here — this test exercises existing routes end to end). Run it against the current `main`-plus-slices-1-4 code; it should pass without any product change. If anything fails, that is a genuine gap slice 5 must fix (a missing permission, a wrong status code) — fix the product code, not the test, unless the test itself is wrong.
- [ ] Run: `cd apps/api && npx vitest run test/phase3-exit.test.ts` — expect PASS (or investigate and fix a real gap if not).
- [ ] Run the full API suite once more to confirm nothing else broke.
- [ ] Commit: `git add apps/api/test/phase3-exit.test.ts && git commit -m "Slice 5: the Phase 3 exit check, both schools, through the real API"`.

### Task 5: See it work and review the design
- Local database: apply no new migration (this slice adds none); `npm run provision -- --pack ../../packs/royal-softech --local` is safe to re-run regardless.
- Start `web-dev` and (if not already running) `worker`; sign in as the PM's local Admin to confirm the dashboard is unchanged for that role, then seed a Co-ordinator's partial setup state through the real services (a year, no classes yet) with a temporary script (deleted after) to see the checklist mid-way, and complete it to see every item turn done.
- Check at 320 px wide with text at 200%: the checklist card's list and links; no sideways scroll; every control at least 44 px; dark and light both read cleanly; no console errors.
- `apple-design` review: read `accessibility.md`, `layout.md`, `writing.md`, `feedback.md` (reused from prior slices' reviews), plus `lists-and-tables.md` for the checklist's own list semantics (each row is a fact plus a link, not an action — check the guidance's "content" best practices for a list that mixes state and navigation).
- Fix what the review finds; note what is left and why.

### Task 6: Prove it, log it, ship it
Mutation checks (each must fail a named test):
1. Change `structure`'s subquery to ignore `is_active` — a switched-off programme must then still count, caught by Task 1's test.
2. Change `classTeachers`'s subquery to drop the "at least one class exists" half — an empty set (no classes at all) must then read as done, caught by Task 1's test.
3. Remove the section filter from `structure`/`classes`/`subjects` — a section-scoped Co-ordinator must then see the other section's progress, caught by Task 1's and Task 2's tests.
4. Remove `status = 'active'` from `year`'s subquery — a draft or closed year must then count, caught by Task 1's test.
5. Hide the `ChecklistCard` conditional so it also renders for an Admin — caught by Task 3's "does not render for an Admin" test.

Then:
- [ ] Log D-062 in `docs/DECISIONS.md` (built to, files touched, the "Co-ordinator only" open choice, tested, design review, not verified by me, not done — and, since this is the Phase 3 exit, a short summary of the whole phase closing).
- [ ] Update `docs/data-model.md` if the checklist merits a line (it stores nothing, so likely just a one-line mention under the academics section, not a new table row), `CLAUDE.md`'s phase line (Phase 3 complete), `docs/build-plan.md` (Phase 3 exit passed for both schools; Phase 4 next, needs PM approval to start), and project memory.
- [ ] Push the branch; replay CI in a fresh clone (all three jobs: api, web, bundle).
- [ ] Open the PR; wait for 6 of 6 on the latest commit.
- [ ] **Ask the PM before merging.**
- [ ] Once merged: provision (no migration this slice, but re-running is safe and confirms nothing broke), ask the PM to deploy, then check the live pages — the Phase 3 exit criterion in `CLAUDE.md`/`docs/build-plan.md`.

## Self-review notes

- Spec coverage: the checklist, computed from the data, linking to each screen (§8) → Tasks 1–3; `phase3-exit.test.ts` for both packs through the real API (§8) → Task 4; staging (§8) → Task 6's last step.
- The two open choices (Co-ordinator-only visibility; "classTeachers" meaning "every active class", not "at least one") are stated in Global Constraints and Task 1, not decided silently.
- Type check: `SetupChecklist` (Task 1) is what the route (Task 2) returns and what `checklist-client.ts`/`ChecklistCard.tsx` (Task 3) consume via the generated `components["schemas"]["SetupChecklist"]`.
