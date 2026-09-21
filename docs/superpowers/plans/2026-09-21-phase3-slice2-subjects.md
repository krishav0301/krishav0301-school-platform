# Phase 3, Slice 2: Subjects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Co-ordinator can keep the school's subject catalogue, say which subjects each programme level teaches, split each into mark components, and set up elective groups; every write audited and role-checked inside its batch.

**Architecture:** The same pattern as slice 1 (`docs/superpowers/plans/2026-09-21-phase3-slice1-structure.md`), extending the `academics` module: migration `0010`, a guard fragment per owner, one `write()` per change, reads scoped by the person's sections, routes declared with `access: { action }`, web model, client and screens.

**Tech Stack:** Cloudflare Workers, Hono with `@hono/zod-openapi`, D1, vitest with `@cloudflare/vitest-pool-workers`, Next.js static export.

**Spec:** `docs/superpowers/specs/2026-09-21-phase3-academic-setup-design.md`, section 5 (approved by the PM in chat, 2026-09-21). Decision to log: D-058.

**How this plan differs from slice 1's:** it lists tasks, files, interfaces and the exact test cases, but not every line of code. The code is written straight into the files, tests first, and lives in the commits. Patterns to copy are named per task.

## Global Constraints

- Everything in slice 1's Global Constraints still holds: one audited `batch()` per write with `onlyIfLastChanged`; the person re-checked inside the write's SQL; `public_id` only to clients; no hard deletes (archive or switch off); words in `messages.ts`; theme tokens only; 44 px controls; modules call each other's `index`/`service` only; every commit ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Marks and credit hours are whole hundredths** (375 = 3.75). The API speaks hundredths (`creditHundredths`, `maxHundredths`); only the web client converts to and from decimals.
- **Who may do what** (spec 5.2): add a subject: any active Co-ordinator or the Super Admin; rename, recode, archive a subject: a whole-school Co-ordinator or the Super Admin; offerings, components, groups: a Co-ordinator whose scope covers the level's section, or the Super Admin. The Admin views only.
- Grading policy, students' elective picks, and pack seeding of subjects are **out of scope**.
- Branch `phase3-slice2-subjects` (created; the spec change is its first commit).

## Tasks

### Task 1: Tables (`apps/api/migrations/0010_subjects.sql`)

Create `subjects`, `elective_groups`, `subject_offerings`, `mark_components` exactly as in spec 5.1 (in that dependency order: subjects, groups, offerings, components). Test first in `apps/api/test/subjects-schema.test.ts` (copy the helper style of `academics-schema.test.ts`), cases:
- subject names unique ignoring letter case; codes unique when present, several without a code allowed; empty name refused.
- one offering per level and subject; credit outside 1 to 10000 refused; `NULL` credit accepted.
- an offering may point at an elective group **of its own level**; a group of another level is refused (`FOREIGN KEY`); no group is accepted.
- a group name is unique per level; `pick_count` outside 1 to 10 refused.
- a component name and an ordinal are each unique per offering; max outside 1 to 100000 refused; ordinal outside 1 to 10 refused.

Run: `cd apps/api && npx vitest run test/subjects-schema.test.ts` (fails: no such table), then add the migration (passes), then the whole API suite.

### Task 2: The permission rows

In `matrix.ts`: add `setup.subjects.view` (Co-ordinator `inst`, Admin `read`, Super Admin `all`), phase 3, directly before `setup.subjects.manage`; change `setup.subjects.manage`'s label to "Manage subjects, offerings, mark components, elective groups" (no "grading policy"). In `permission-matrix.test.ts` add to `exactly`: `"setup.subjects.manage": ["COO", "SUP"]`, `"setup.subjects.view": ["COO", "ADM", "SUP"]`, and one `it` that the Admin's view is read-only and the Admin cannot manage. Test first, then `npm run gen:permissions`, then commit with `docs/permission-matrix.md`.

### Task 3: The subject catalogue service

Files: `guard.ts` (add `coordinatorAnywhere(n)`: active Super Admin or active Co-ordinator of any scope; and small helpers `levelSection(n)`, `offeringSection(n)`, `componentSection(n)`, `groupSection(n)` returning the SQL expression for the section id of a level, offering, component or group by public id parameter `?n`, using aliases that do not clash with `gu`, `ga`), `write.ts` (map `FOREIGN KEY constraint failed` to `check_failed` so callers word it), `schema.ts` (append `CreateSubjectSchema { name, code? }`, `SubjectChangesSchema { name?, code (nullable)?, archived? }`), new `subjects.ts` (`createSubject`, `updateSubject`), `service.ts` (export). Test first in `apps/api/test/subjects-catalogue.test.ts` (copy `academics-programmes.test.ts`): 
- adds a subject and audits it (`academics.subject.created`); a repeat name in another letter case is a `conflict` with no false audit entry; a repeat code is a `conflict`.
- **a section-scoped Co-ordinator can add** a subject; the Admin, Accountant, Teacher, Student, and a switched-off Co-ordinator cannot (`not_allowed`, nothing written, creating the switched-off person before taking the "before" counts).
- rename, recode and archive: a whole-school Co-ordinator may; a **section-scoped Co-ordinator may not** (`not_allowed`); an unknown id is `not_found`; changing nothing records nothing.
- invalid: empty name, name over 120, code over 20, an unknown field.

### Task 4: Groups, offerings and components (service)

Files: `schema.ts` (append `CreateGroupSchema { name, pickCount? }`, `GroupChangesSchema`, `CreateOfferingSchema { levelId, subjectId, creditHundredths? (nullable), groupId? (nullable) }`, `OfferingChangesSchema { creditHundredths (nullable), groupId (nullable), active }`, `CreateComponentSchema { name, maxHundredths }`, `ComponentChangesSchema { name, maxHundredths, active }`), new `curriculum.ts` (`createGroup`, `updateGroup`, `createOffering`, `updateOffering`, `addComponent`, `updateComponent`), `service.ts`. Test first in `apps/api/test/subjects-curriculum.test.ts` (copy `academics-classes.test.ts`, building a programme and level with the slice 1 services), cases:
- **groups:** create numbers nothing but records; unique name per level is a `conflict`; `pickCount` default 1, over 10 is invalid; update name, pick count, switch off; a section-scoped Co-ordinator of another section is `not_allowed`; unknown level or group is `not_found`; Admin and others `not_allowed`.
- **offerings:** add a subject to a level (with and without credit and group); a repeat is `conflict`; an **archived subject** and a **switched-off level or programme** are `invalid`; a group of another level is `invalid`; another section's Co-ordinator is `not_allowed` even with the right ids; update credit (also back to none), move to another group of the same level, remove the group, switch off and on; a group of another level in an update is `invalid` and nothing changes; changing nothing records nothing.
- **components:** add numbers 1, 2, 3 in order, including several added at once (no clash); the 11th is `invalid`; a repeat name is `conflict`; max of 0 or over 100000 is `invalid`; update name, max and switch off; another section's Co-ordinator `not_allowed`.
- every refusal writes nothing and no audit entry; the audit chain still verifies.

### Task 5: Reads, routes and the contract

Files: `schema.ts` (append response schemas `Subject`, `SubjectList`, `Curriculum` with `groups[]` and `offerings[]` each carrying `subject`, `creditHundredths`, `group` and `components[]`), `queries.ts` (`listSubjects(db)`, `getCurriculum(db, sections, levelId)`: one `db.batch` of a level-visibility check, the groups, and the offerings with their components; returns `null` when the level does not exist or is outside the person's sections), `routes.ts` (ten routes from spec 5.3; reuse `fail()`), `index.ts`. Test first in `apps/api/test/subjects-routes.test.ts` (copy `academics-routes.test.ts`): 401 signed out and garbage body unread; students, teachers, accountants 403 on every new route; the Admin 200 on the two reads and 403 on every write; Co-ordinator end to end (subject, group, offering with group, component, curriculum read shows it all, patches); a **+2 Co-ordinator cannot read (404) or change (403) a Bachelor's level's curriculum, even with guessed ids**; a section-scoped Co-ordinator can add a subject (201) but not rename it (403); status codes 400 (bad shape), 422 (archived subject), 404, 409 (repeat); `Cache-Control: no-store`; audit chain. Then `npm run gen:openapi`, `npm run gen:api` in `apps/web`, full API suite, `check-boundaries`.

### Task 6: Web model, client and words

Files: `apps/web/src/setup/model.ts` (types `Subject`, `Curriculum`, `Offering`, `Group`, `Component`; `parseHundredths(text)` returning whole hundredths or `null` for text that is not a number with at most two decimals, and `formatHundredths(n)`; `subjectChoices(subjects, offerings)` = unarchived subjects not already offered; `canManageSubjects` is `canManageStructure`), `client.ts` (`loadSubjects`, `loadCurriculum(levelId)`, `createSubject`, `setSubjectArchived`, `createGroup`, `setGroupActive`, `addOffering`, `setOfferingGroup`, `setOfferingActive`, `addComponent`, `setComponentActive`), `messages.ts` (new `setup.*` keys for the two screens). Test first (`setup-model.test.ts`, `setup-client.test.ts`, extending the slice 1 files): `parseHundredths` accepts "3", "3.5", "3.75", "0.25", " 4 " and refuses "", "3.756", "-1", "abc", "1e2", "3,5"; `formatHundredths` round trips (375 gives "3.75", 300 gives "3", 50 gives "0.5"); `subjectChoices` hides archived and already-offered; each client call sends what the API expects and maps 403, 404, 409, 422 and a dropped connection.

### Task 7: The screens

Files: `SubjectsScreen.tsx`, `CurriculumScreen.tsx`, pages `apps/web/src/app/portal/setup/subjects/page.tsx` and `curriculum/page.tsx`, `SetupLayout.tsx` (two more tabs), `setup.module.css` (only if needed), `page-weight-budget.json` (`ignore` gains `portal/setup/subjects` and `portal/setup/curriculum`). First run the `ui-ux-pro-max` searches (forms with related fields, nested lists) as in slice 1, never `--persist`. Test first in `setup-screens.test.tsx`: the sub-menu now has six links with exactly one current; the subjects list shows name, code and an "Archived" badge and offers Archive only to those who may change it (a whole-school Co-ordinator), with the add form only for a Co-ordinator; the curriculum view lists groups (with how many to pick), offerings (subject, credits as decimals, group, switched-off badge) and components (name and max as decimals), the read-only reader sees no forms or buttons; a read-only empty state does not invite adding (slice 1's review finding); success messages name the action.

### Task 8: See it work and review the design

Apply migration `0010` to the local database (`npm run provision -- --pack ../../packs/royal-softech --local`), start only `web-dev` (another chat's Worker may hold 8787), and look at the new screens as the PM's already signed-in Admin (read-only, empty catalogue): 320 px wide with text at 200%, 44 px controls, console errors, light and dark. I do not type passwords, so the add flows are left to the PM. Run the `apple-design` review (read the pages before citing), fix what is a defect, record the rest.

### Task 9: Prove it, log it, ship it

Mutation checks (script as in slice 1; each must fail a named test): the section guard on offerings; the whole-school guard on renaming a subject; the archived-subject check; the group-belongs-to-level check; the component ordinal numbering; the section filter on the curriculum read; `onlyIfLastChanged`. Then D-058 in `DECISIONS.md`, `data-model.md` rows for the four tables, status lines; push; replay CI in a fresh clone (`ci-replay.sh`); open the PR; wait for 6 of 6 on the latest commit; **ask the PM before merging**.
