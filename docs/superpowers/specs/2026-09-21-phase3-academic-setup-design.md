# Phase 3: academic setup, people and approvals

Status: design approved by the PM in chat, 2026-09-21 ("yes"), after two answers: elective groups **approved**, placeholders stand in for the real programme, subject and staff lists.
Rules it rests on: D-004 (scopes), D-006 (year with terminals), D-008 (pack, seam before builder), D-021 (sessions, re-check inside the batch), D-025 (one permission matrix), D-026 (packs only add and update), D-054 (real content last), `CLAUDE.md` sections 2 to 7, `docs/data-model.md` (Phase 3 tables), `docs/build-plan.md` (Phase 3).
Logged as D-056.

## 1. Goal

The Co-ordinator can set up a school year: the academic year, programmes and their levels, classes, terminals, subjects with mark components, and elective groups. The Admin creates Co-ordinators and Accountants; the Co-ordinator creates teachers, assigns them to subjects and classes, and picks each Class Teacher. A generic approvals engine and the Admin inbox go live, first used for website content a Co-ordinator drafts.

Not in Phase 3: students, enrollments and admissions (Phase 4), attendance (5), fees and the four other approval types (6), marks, grading policy and results (7), year rollover and closing a year (8), real email delivery (9), the real programme, subject and staff lists (last, D-054). Nothing here is public, so the `geo-*` skills do not apply.

## 2. Slices

Each slice: design check in chat, feature branch, tests first, break the code on purpose, `apple-design` review for screens, pull request with CI 6 of 6, report.

| # | Slice | Delivers |
|---|---|---|
| 1 | Structure | Academic years, programmes and levels, classes, terminals; the pack's `academics` block; Co-ordinator screens |
| 2 | Subjects | Subject offerings per programme level, mark components, elective groups |
| 3 | People | Admin creates Co-ordinators and Accountants; Co-ordinator creates teachers, teacher assignments and Class Teachers; deactivate and reactivate; first-password flow |
| 4 | Approvals | The engine, the Admin inbox, Co-ordinator content drafts sent for approval |
| 5 | Checklist and exit | The Co-ordinator setup checklist; the automated Phase 3 exit check for both schools; staging check |

## 3. Decisions that shape every slice

1. **One module, `academics`** (`apps/api/src/modules/academics/`: routes, service, queries, schema, index). People stay in `accounts`; the engine is its own module, `approvals`. Modules call each other's services only (`scripts/check-boundaries.mjs`).
2. **Programme, level and subject data come from two places**: the pack seeds them **only where missing**, and Co-ordinator screens edit them afterwards. A re-applied pack never overwrites a screen edit. This is a small exception to "packs add and update" (D-026), because this is data people edit, unlike a setting.
3. **The "+2 and Bachelor's" template is data in the pack** (the `academics` block), not a separate template file. Seam before builder: a shared template folder waits for a second school that wants to reuse one.
4. **The pack's `academics` block holds only what the site block does not.** Each entry names a programme by the key it has in `site.programmes`, which already gives its name, section and affiliation, and lists its levels. A key not in `site.programmes` fails the pack check.
5. **Subject offerings attach to a programme level, not to a class.** "Grade 11 Science teaches these subjects" is set once and every class of that level inherits it, so a new year does not mean re-entering every subject. Year-specific facts (which teacher, which class) live in assignments. This changes the sketch in `data-model.md` (offerings per class), which is updated with slice 2.
6. **A closed year rejects every write**, enforced twice: the service's conditional SQL, and `BEFORE INSERT` and `BEFORE UPDATE` triggers on the year's child tables (classes, terminals, assignments) as a second guard (D1 has no database accounts). Closing a year is Phase 8; Phase 3 builds the guard and the status, and the tests set a year to closed directly.
7. **Every write** is one `batch()`, re-checks the person's active role inside it (never the token), and appends an audit entry in the same batch, written only if the change happened (`onlyIfLastChanged`, as in `content/service.ts`). Nothing is deleted: rows are deactivated or archived.
8. **Section scope holds.** A section-scoped Co-ordinator sees and changes only programmes of their section, and classes and terminals through them (`canAccessSection`, `allowedSections`). Ids from the URL are never trusted alone.
9. **Words** live in `apps/web/src/i18n/messages.ts`; the screens use theme tokens only; new components pass `apps/web/test/guards.test.ts` and get a markup test. Screens are designed with `ui-ux-pro-max` (never `--persist`) and reviewed with `apple-design`.
10. **Migrations are hand-written SQL**, numbered after `0008`, backward compatible. Slice 1 is `0009_academic_structure.sql`.

## 4. Slice 1: structure (detailed)

### 4.1 Tables (`0009_academic_structure.sql`)

Ids shown to clients are `public_id`, never the integer. Dates are AD text (`YYYY-MM-DD`, checked with `GLOB`); the screens accept and show BS through the date module.

| Table | Columns | Rules |
|---|---|---|
| `academic_years` | `id`, `public_id`, `bs_year` (integer, unique), `label` (unique), `start_date`, `end_date`, `status` (`draft`, `active`, `closed`), `created_at`, `closed_at` | `end_date > start_date`. A partial unique index allows **one** `active` year. `bs_year` must be a verified BS year (checked in the service with `isVerifiedBsYear`; dates converted with `bsToAd`, and an unverified year is refused) |
| `programmes` | `id`, `public_id`, `key` (unique), `name`, `section_id` -> `sections`, `affiliation`, `ordering`, `is_active` | Names such as "+2 Science" are data, never code |
| `levels` | `id`, `programme_id` -> `programmes`, `ordinal`, `name`, `is_active` | Unique on (`programme_id`, `ordinal`). Also `UNIQUE (id, programme_id)`, so a class can point at a level and its programme together |
| `classes` | `id`, `public_id`, `academic_year_id`, `programme_id`, `level_id`, `label` (text, `''` when none, for example Morning), `is_active` | Composite foreign key (`level_id`, `programme_id`) -> `levels (id, programme_id)`: a class cannot pair a level with another programme's. Unique on (`academic_year_id`, `level_id`, `label`). Trigger: no insert or update when the year is `closed` |
| `terminals` | `id`, `public_id`, `academic_year_id`, `name`, `ordinal` | Unique on (`academic_year_id`, `ordinal`). Same closed-year trigger. The word shown is the school's own (`term.terminal`) |

The Class Teacher column arrives in slice 3 (an `ALTER TABLE ... ADD COLUMN`, so slice 1 stays deployable alone).

Naming: the institution's **section** (`sections`: +2, Bachelor's) is unchanged. A class's `label` is a different thing (a shift or group within a level); the code and words keep the two apart.

### 4.2 Pack block

`PackSchema` gains an optional `academics` block (default empty, so both existing packs stay valid until they add it):

```json
"academics": { "programmes": [ { "key": "plus2-sample", "levels": [ "Grade 11", "Grade 12" ] } ] }
```

`parsePack` checks that each key exists in `site.programmes`, that keys and level names are unique, and the counts are bounded. `packOperations` adds `INSERT ... ON CONFLICT DO NOTHING` rows for each programme (name, section, affiliation taken from the site block) and level (ordinal from the list order). Re-applying changes nothing. Placeholders: Royal gets its two sample programmes (Grade 11 and 12; Year 1 to 4), marked `OPEN:` in DECISIONS as the unconfirmed list; the sample school gets its four (Nursery and KG; Grades 1 to 5; 6 to 8; 9 and 10). Academic years, classes and terminals are **not** in packs (they are yearly data the Co-ordinator enters; tests and demos create them through the service).

### 4.3 API (`/api/academics`, all declared with `access: { action }`)

| Route | Action |
|---|---|
| `GET /years`, `GET /programmes` (with levels), `GET /classes?year=`, `GET /terminals?year=` | `setup.structure.view` (new row) |
| `POST /years`, `PATCH /years/{id}` (label, dates, only while `draft`), `POST /years/{id}/activate` | `setup.structure.manage` |
| `POST /programmes`, `PATCH /programmes/{id}`, `POST /programmes/{id}/levels`, `PATCH /levels/{id}` (rename, deactivate) | `setup.structure.manage` |
| `POST /classes`, `PATCH /classes/{id}` (label, deactivate) | `setup.structure.manage` |
| `POST /terminals`, `PATCH /terminals/{id}` | `setup.structure.manage` |

Activating a year is refused while another is active (closing one is Phase 8). Deactivating a programme, level or class that has classes or enrollments later stays allowed; a deactivated row is hidden from pickers but its history is kept.

### 4.4 Permission matrix

New row `setup.structure.view` (phase 3): Co-ordinator `inst`, Admin `read`, Super Admin `all`. `setup.structure.manage` stays Co-ordinator `inst` and Super Admin `all`. `docs/permission-matrix.md` is regenerated with `npm run gen:permissions`. The Accountant and Teacher gain read rows in the later phases that need them.

### 4.5 Screens

A **Setup** area in the portal (menu entry through the nav registry, shown to Co-ordinator and Admin; the Admin sees it read-only): Academic years, Programmes and levels, Classes, Terminals. Nepali (BS) date entry uses the existing component. One prominent button per view; a menu of one entry is not shown; each screen checked at 320 px wide with text at 200%; the shape of a page shows while it loads.

### 4.6 Tests (written before the code)

- Domain: a class needs a level of its own programme (composite foreign key); a duplicate class, terminal ordinal or level ordinal is refused; only one active year; an unverified BS year is refused; end before start is refused.
- Closed year: every write to classes and terminals is refused, by the service **and** by the trigger when the guard is bypassed.
- Permissions: generated from the matrix, plus independent hand-written ones (Co-ordinator may manage, Admin may only read, Accountant, Teacher, Student and signed-out may not); under both scope settings; a **+2-scoped Co-ordinator cannot read or change a Bachelor's programme, class or terminal**, including with a guessed id.
- Failure paths: a duplicate submit; a deactivated Co-ordinator whose token is still valid is refused inside the batch; the audit entry exists only when the change did, and the audit chain verifies.
- Pack: an `academics` key not in `site.programmes` fails; applying twice changes nothing; a screen edit survives a re-applied pack.
- Second school: the sample school's structure (single-level programmes, `school` section) runs every flow beside Royal's.
- Mutation checks: break each guard (composite key, closed-year trigger, scope filter, role re-check) and confirm a test fails.

## 5. Slice 2: subjects (outline; detailed in its own plan)

- `subject_offerings`: a subject taught at a programme level, with credit hours; `subjects` are the school's catalogue (name, code, archived, never deleted).
- `mark_components`: per offering, name and maximum marks, stored as integer hundredths, never floats.
- **Elective groups (approved):** `elective_groups` belong to a programme level; a group lists its offerings and how many a student picks (default 1). Phase 3 stores groups only; a student's pick is saved when students exist (Phase 4), which is what lets a marks grid list only the students who take a subject.
- Grading policy is **not** in Phase 3. The matrix row `setup.subjects.manage` still says "grading policy"; its label is corrected and the policy is built with results in Phase 7 (approved with this design).
- Permissions: `setup.subjects.manage` (Co-ordinator `inst`, Super Admin `all`), plus a read row.

## 6. Slice 3: people (outline)

- Rows already in the matrix: `accounts.staff.create` (Admin), `accounts.teacher.create` (Co-ordinator), `accounts.deactivate`, `setup.assignments.manage`.
- `teacher_assignments` (teacher, subject offering, class, academic year) and a nullable Class Teacher on `classes`; a `staff_profiles` row (designation, home section) per staff user.
- **First password:** email is a development adapter until Phase 9, so the creator sees a **one-time temporary password on screen**, returned once with `Cache-Control: no-store`, never stored in the clear and never in the audit entry. The new user is created with `must_change_password = 1`.
- **Found while reading the code:** `must_change_password` exists in the schema and is cleared by a password reset, but nothing enforces it at sign-in. Slice 3 builds the enforcement (a sign-in with the flag set returns a "change your password first" state, never a full session) and its tests.
- The creator's scope narrows what they can create (a section-scoped Co-ordinator creates teachers only for their section). Deactivation ends the person's sessions at the next refresh, and money, approval and publish actions already re-check.

## 7. Slice 4: approvals (outline)

- **Not a workflow engine (section 10).** One table, five fixed kinds (`website_content`, `fee_structure`, `discount`, `reversal`, `refund`); only `website_content` is wired in Phase 3.
- `approval_requests` as in `data-model.md`: kind, status (`pending`, `approved`, `declined`, `stale`, plus `withdrawn`, added here so a requester can take a request back), requester, subject type and id, `subject_version`, snapshot (JSON), decider, time, reason. A partial unique index allows **one pending request per subject**. `content_items` gains an integer `version` that every write increments; that is the fingerprint.
- **Handlers register from the composition root.** `approvals` defines the interface (`describe`, `applyStatements`, `currentVersion`); `content` implements it; the composition root wires them, so `approvals` never imports `content` and the boundary check holds.
- **Approve-and-apply is one batch** with conditional SQL: mark `approved` only where `status = 'pending'`, the decider is an active Admin or Super Admin, the decider is not the requester, and the version still matches; the handler's apply statements run only if that row was just approved; the audit entry is written only if the change happened. A second click, a retry or a race returns "already resolved" and applies nothing twice. A changed subject returns `stale` and marks the request stale.
- Co-ordinator flow: draft (existing `content.draft` row), **Send for approval** (item goes `waiting`, request created, both in one batch), Admin **Approve** (item goes live) or **Decline** with a reason (back to draft). The Admin keeps publishing directly (D-039).
- Admin inbox screen: pending requests with the snapshot, the requester, and the two actions. The matrix gains rows for requesting and for viewing one's own requests.
- Each future kind adds its own handler in its own phase; none of them needs a change to the engine.

## 8. Slice 5: checklist and exit (outline)

- A setup checklist on the Co-ordinator's home page, computed from the data (a year exists and is active, programmes and levels exist, classes exist, terminals exist, subjects exist, teachers exist, Class Teachers are set), each item linking to its screen. Nothing is stored for it.
- `apps/api/test/phase3-exit.test.ts`: each school's structure, subjects, people and a content approval through the real API, both packs, permissions and audit chain, as in `phase2-exit.test.ts`; shown to fail when a guard is broken.
- Staging: provision, then the PM deploys; live checks after.

## 9. Open points touched

- `OPEN:` Programme, stream and subject names and the staff list are placeholders (unconfirmed, D-054).
- The elective-group question is answered (approved 2026-09-21) and stops being an open point when D-056 is logged.
- Grading policy timing: Phase 7 (approved with this design).
- Not decided here and left at their defaults: semester versus year (yearly with terminals, D-006), academic year start month and holidays (config placeholders), the four other approval types (Phase 6).
