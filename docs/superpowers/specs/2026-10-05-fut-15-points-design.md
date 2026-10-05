# FUT 2026-10-05: structure, terms, classes, subjects and admissions (design)

Source: the PM's functional user test of staging on 2026-10-05 (15 points, numbered as in that session). Approved in conversation the same day. Decision number on build: D-114.

**In this build:** points 1, 2, 4, 5, 6, 7, 7b, 8, 9, 11, 13, 14, 15.
**Held for a design session with real mark sheets:** 3 (grading), 10 (credit hours and mark components may move to an exam pattern), 12 (electives, theory and practical redesign). Nothing here pre-empts them.

**Touches:** no permission rows change. No fees, results or audit-chain logic changes; every new write emits its audit entry in the same batch as today.

## 1. Words (points 1, 8)

The words are already school settings (`apps/api/src/core/config/terminology.ts`, D-008). Change the core defaults, so every school gets the clearer words unless its pack says otherwise:

| Key | Old default | New default | Meaning |
|---|---|---|---|
| `term.section` | Section | **Wing** | Top group: +2, Bachelor's |
| `term.programme` | Programme | **Course** | +2 Science, BBS, MBA in Finance |
| `term.classSection` (new) | | **Section** | A class's division: A, B, Morning (was "Label") |

Internal names (tables, columns, API fields, permission ids) do not change. Screens that type "label" for a class use `term.classSection` instead. The message catalog is checked for any hard-typed "Section"/"Programme" that should come from a term.

## 2. Level length (points 2, 5)

- Reuse `levels.usual_months` (migration 0030; 1 to 60). Add a level and Edit a level both show **Length in months**, required on add. Editing may change it; clearing it is not offered once set.
- Existing levels with no length show "Length not set" and **cannot be added to a new term** until the Admin sets it.
- **Term rule:** a level may join a term only if `round(term length in months) = level.usual_months`. Term length is computed from the term's AD start and end dates in the date module (no new conversion code); "rounded" means to the nearest whole month, so a term a few days short of 6 months counts as 6.
- Enforced in the service (inside the same batch as the term-level insert, conditional SQL) **and** shown in the screen. An open term already holding a level with no length or a mismatched length is **flagged** on the Academic terms page, not blocked.

## 3. Term creation and pickers (points 4, 6, 9, 14)

- One shared **Wing › Course › Level** picker (web component), used by: Create a term, Curriculum, Add a student ("Applying for"), and the admissions class picker. A wing with one course, or a course with one level, preselects it (a menu of one entry is not shown, D-030).
- **Create a term** lists only levels that have a length, match the term's length, and are not in another open term (the last rule is already enforced by the `term_levels_insert` trigger; this adds the screen side). When the term closes, its levels are offered again.
- **Curriculum** shows by default only levels in an open term, with a **Show all levels** switch for preparing ahead. The curriculum stays per level (unchanged data model).

## 4. Classes (points 7, 7b)

- Switch off and Delete in one row, aligned with the other row actions.
- **Edit** changes the section name only. Term and level stay fixed (students, attendance, marks and fees hang off the class). Same uniqueness rule as creating a class. Audit entry in the same batch.

## 5. Subjects per wing (point 11)

- `subjects.section_id` (the wing), required for new subjects. Name unique **within a wing** (case-insensitive), code unique within a wing.
- A subject can join only the curriculum of a level in its own wing (service check and SQL condition).
- A section-scoped Co-ordinator sees and manages only their wing's subjects; data-level tests as for other section-owned data.
- **Migration 0031** sorts existing subjects: used only in one wing's curricula, assigned to that wing; used in both, split into one copy per wing with offerings repointed; unused, left without a wing and shown as "Choose a wing" (cannot join a curriculum until set). Safe to repeat; backward compatible with the running Worker until the deploy.

## 6. Teaching in Setup (point 13)

Teaching becomes a Setup step after Curriculum (terms, classes, subjects, curriculum, teaching). People keeps a link to it. No change to the teaching rules.

## 7. One open term per level, everywhere (point 15)

- Admissions class picker: the switched-on classes of the chosen level in **its** open term (exactly one, by point 6). Fixes "No open class of this level yet" when the class is in a second open term (`apps/web/src/admissions/ClassPicker.tsx`, which used `defaultYearId`, the first active term only).
- Audit every other `defaultYearId` caller (Teaching, Fees, Classwork, Attendance and others) and fix any that hide a second open term's classes.

## Testing

- Tests first for: the length-match rule (round-up and round-down edges, missing length), a level in another open term, subject-wing rules (unique within wing, cross-wing curriculum refused, section-scoped Co-ordinator), class edit (name only, duplicate refused, closed term refused), the class picker across two open terms, and the 0031 sort (one wing, both wings, unused).
- Break each rule on purpose and see a named test fail.
- Permission matrix and cross-scope tests unchanged and passing; second-school (`sample-basic-school`) test passing with its own words.
- UI: `ui-ux-pro-max` before, `apple-design` review after; every changed screen at 320 px with text at 200%.
- Replay CI in a fresh clone (migration and generated files change).

## Release

Feature branch `fut-15-points`, one PR, merge on CI 6/6. Staging: Time Travel bookmark, migration 0031 with the pack, deploy with a fresh web build (the PM runs provision and deploy).
