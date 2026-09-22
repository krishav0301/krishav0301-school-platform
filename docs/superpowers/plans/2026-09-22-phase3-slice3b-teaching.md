# Phase 3, Slice 3b: Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Co-ordinator assigns one teacher to each subject a class takes, and picks each class's Class Teacher; a section-scoped Co-ordinator may only touch their own section's classes and teachers.

**Architecture:** A new file in the `academics` module (`teaching.ts`, re-exported from `service.ts`/`index.ts`) plus a migration adding `teacher_assignments` and `classes.class_teacher_user_id`. The teacher-eligibility guard (is this teacher the actor's to manage) is moved from `accounts/guard.ts` into `accounts/service.ts` so `academics` can import it (modules call each other's `service`, never their internals). Same write pattern as slices 1 to 3a: one audited batch, actor re-checked in SQL, `onlyIfLastChanged`. The People area gets its promised sub-menu (Staff, Teaching).

**Tech Stack:** Cloudflare Workers, Hono with `@hono/zod-openapi`, D1, Next.js static export.

**Spec:** `docs/superpowers/specs/2026-09-21-phase3-academic-setup-design.md`, section 6.2 (outline) and the chat design approved 2026-09-22. Decision to log: D-060.

**Format:** as in slices 2 and 3a: tasks, files, interfaces and exact test cases; the code is written straight into the files, tests first.

## Global Constraints

- Everything in slices 1 to 3a's Global Constraints still holds: one audited batch per write with `onlyIfLastChanged`, actor re-checked in SQL (never the token), `public_id` only to clients, no hard deletes (an assignment is replaced, not deleted), words in `messages.ts`, theme tokens only, 44 px controls, modules call each other's `index`/`service` only, every commit ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Section scope holds**: a section-scoped Co-ordinator may only assign a class of their own section, and only a teacher whose home section is theirs (institution-wide Co-ordinators and the Super Admin may pick any teacher for any class).
- **Closed year rejects every write**: the service's own check, and triggers on `teacher_assignments` and (already existing) on `classes`.
- **No requirement that a Class Teacher already teach a subject in that class** (an open design choice, not stated in the spec; flagged to the PM, default taken: independent).
- Branch `phase3-slice3b-teaching`.

## Tasks

### Task 1: Migration `0012_teaching.sql`
Files: `apps/api/migrations/0012_teaching.sql`.
```sql
-- Teaching (Phase 3, slice 3b, D-060): who teaches what, and each class's Class Teacher.
-- Nothing is deleted: reassigning a subject ends the old active row and starts a new one.

CREATE TABLE teacher_assignments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  teacher_user_id INTEGER NOT NULL REFERENCES users (id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

-- One active teacher per subject in a class. A past assignment stays, inactive, for history.
CREATE UNIQUE INDEX teacher_assignments_one_active ON teacher_assignments (class_id, offering_id) WHERE is_active = 1;

-- The offering must be the class's own level (mirrors the classes/levels composite check, which cannot be
-- expressed as a foreign key here because a class does not carry its level id alongside an offering id).
CREATE TRIGGER teacher_assignments_same_level BEFORE INSERT ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the offering is not this class''s level')
   WHERE (SELECT level_id FROM classes WHERE id = NEW.class_id)
      <> (SELECT level_id FROM subject_offerings WHERE id = NEW.offering_id);
END;

CREATE TRIGGER teacher_assignments_year_open_insert BEFORE INSERT ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

CREATE TRIGGER teacher_assignments_year_open_update BEFORE UPDATE ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

ALTER TABLE classes ADD COLUMN class_teacher_user_id INTEGER REFERENCES users (id);

-- A teacher is Class Teacher of at most one class per academic year. The existing classes_year_open_update
-- trigger already blocks this column changing once the year is closed (it fires on any update to the row).
CREATE UNIQUE INDEX classes_one_class_teacher_per_year ON classes (academic_year_id, class_teacher_user_id)
  WHERE class_teacher_user_id IS NOT NULL;
```
Test first (`apps/api/test/teaching-schema.test.ts`, copy the shape of `academics-schema.test.ts`): inserting an assignment whose offering is of a different level than the class fails with the trigger's message; two active assignments for the same (class, offering) fails UNIQUE; deactivating one and inserting a new one for the same pair succeeds; inserting/updating an assignment on a class of a closed year fails with 'the academic year is closed'; setting `class_teacher_user_id` on two classes of the same year to the same teacher fails UNIQUE; the same teacher as Class Teacher in two different years succeeds; updating a closed year's class (any column) still fails (existing trigger).

- [ ] Write the failing tests above against a bare `.execute()` of the migration (see `academics-schema.test.ts` for the harness).
- [ ] Run: `cd apps/api && npx vitest run test/teaching-schema.test.ts` — expect FAIL (table does not exist).
- [ ] Add `0012_teaching.sql` as written above.
- [ ] Run the test again — expect PASS.
- [ ] Commit: `git add apps/api/migrations/0012_teaching.sql apps/api/test/teaching-schema.test.ts && git commit -m "Slice 3b: teacher_assignments and the Class Teacher column"`.

### Task 2: One permission row
File: `apps/api/src/core/permissions/matrix.ts`, next to `setup.assignments.manage` (line 121).
```ts
row(G.setup, "setup.assignments.view", "View teacher assignments and Class Teachers", 3, { COO: inst, ADM: read, SUP: all }),
```
**Interfaces produced:** the action string `"setup.assignments.view"`, usable in `defineRoute`'s `access`.
Test first, in `apps/api/test/permission-matrix.test.ts` (add alongside the existing `setup.assignments.manage` assertions): `exactly` `{ COO: "inst", ADM: "read", SUP: "all" }` for `setup.assignments.view`; an independent hand-written test (in `academics-routes.test.ts`, written in Task 5) that an Accountant, Teacher, Student and signed-out person get 403/401 reading `/api/academics/classes/{id}/teaching`.
- [ ] Add the failing matrix assertion.
- [ ] Run: `cd apps/api && npx vitest run test/permission-matrix.test.ts` — expect FAIL (row missing).
- [ ] Add the row to `matrix.ts`.
- [ ] Run `npm run gen:permissions` (from `apps/api`) to refresh `docs/permission-matrix.md`.
- [ ] Run the test again — expect PASS.
- [ ] Commit: `git add apps/api/src/core/permissions/matrix.ts docs/permission-matrix.md apps/api/test/permission-matrix.test.ts && git commit -m "Slice 3b: setup.assignments.view"`.

### Task 3: Move the teacher-eligibility guard into `accounts/service.ts`
Files: `apps/api/src/modules/accounts/guard.ts` (move the teacher branch out), `apps/api/src/modules/accounts/service.ts` (add the export).
Today `accounts/guard.ts`'s `actorMayManage(a, t)` mixes three branches (Super Admin, Admin-over-Co-ordinator/Accountant, Co-ordinator-over-teacher) in one fragment. Slice 3b needs only the third branch, addressable on its own, and importable by `academics` (which may only import `accounts`'s `index` or `service`, never `guard`).

Add to `accounts/service.ts`:
```ts
/**
 * True when the actor may treat this teacher as their own (D-059's Co-ordinator branch, reused by the
 * `academics` module for teaching assignments, D-060): a Super Admin, or an active Co-ordinator who is
 * institution-wide or whose one section is the teacher's home section. `a` and `t` are `?a`/`?t` public ids.
 */
export const teacherManageableBy = (a: number, t: number): string =>
  `EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
            WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1
              AND (ma.role = 'super_admin'
                   OR (ma.role = 'coordinator' AND EXISTS (
                         SELECT 1 FROM users tv JOIN role_assignments tb ON tb.user_id = tv.id LEFT JOIN staff_profiles tp ON tp.user_id = tv.id
                          WHERE tv.public_id = ?${t} AND tb.is_active = 1 AND tb.role = 'teacher'
                            AND (ma.scope_type = 'institution' OR tp.home_section_id = ma.section_id)))))`;
```
Change `accounts/guard.ts`'s `actorMayManage` to call it (no behaviour change, so no new test is needed there — the existing `staff-service.test.ts` and `staff-routes.test.ts` must still pass unchanged):
```ts
export const actorMayManage = (a: number, t: number): string =>
  `EXISTS (
     SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
      WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1 AND mu.public_id <> ?${t}
        AND (
          ma.role = 'super_admin'
          OR (ma.role = 'admin' AND EXISTS (
                SELECT 1 FROM users tu JOIN role_assignments ta ON ta.user_id = tu.id
                 WHERE tu.public_id = ?${t} AND ta.is_active = 1 AND ta.role IN ('coordinator', 'accountant')))
          OR ${teacherManageableBy(a, t)}
        )
   )`;
```
Note `teacherManageableBy` re-checks `mu.is_active`/`ma.is_active` a second time when nested this way; that is harmless (SQLite short-circuits) and keeps the fragment usable standalone. Update the aliases comment at the top of `guard.ts` to mention `mu`/`ma` are shared with `service.ts`'s fragment.

**Interfaces produced:** `teacherManageableBy(a: number, t: number): string`, imported by `academics/teaching.ts` as `import { teacherManageableBy } from "../accounts/service";`.

- [ ] Change `guard.ts` and add the export to `service.ts` as above.
- [ ] Run: `cd apps/api && npx vitest run test/staff-service.test.ts test/staff-routes.test.ts` — expect PASS unchanged (this proves the refactor kept behaviour).
- [ ] Commit: `git add apps/api/src/modules/accounts/guard.ts apps/api/src/modules/accounts/service.ts && git commit -m "Slice 3b: factor out teacherManageableBy so academics can reuse it"`.

### Task 4: The teaching guard fragment (academics)
File: `apps/api/src/modules/academics/guard.ts` (add, next to the other section helpers).
```ts
/** The section id of a CLASS, given its public id as parameter `?n`, for `coordinatorForSection`. */
export const classSection = (n: number): string =>
  `(SELECT pv.section_id FROM classes cl JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE cl.public_id = ?${n})`;
```
No new test file: this is exercised through Task 5's service tests (a class outside scope is not found by the write; see `look()`'s use of `classSection` there).
- [ ] Add `classSection` to `guard.ts`.
- [ ] Commit with Task 5 (same feature, one commit is fine here since `classSection` has no caller yet).

### Task 5: The teaching service
Files: `apps/api/src/modules/academics/teaching.ts` (new), `apps/api/src/modules/academics/service.ts` (add `export * from "./teaching";`), `apps/api/src/modules/academics/index.ts` (add `getTeaching` to the read export list).

**Consumes:** `coordinatorForSection`, `classSection` (`./guard`), `teacherManageableBy` (`../accounts/service`), `write`, `firstMessage`, `Done` (`./write`), `newPublicId` (`../../core/ids`).
**Produces:** `setAssignment(db, auditKey, actor, input: { classId: string; offeringId: string; teacherId: string | null }): Promise<Done>`, `setClassTeacher(db, auditKey, actor, classId: string, teacherId: string | null): Promise<Done>`, `getTeaching(db, sections, classId): Promise<Teaching | null>` (read, in `queries.ts`, see below).

```ts
import { classSection, coordinatorForSection } from "./guard";
import { teacherManageableBy } from "../accounts/service";
import { newPublicId } from "../../core/ids";
import { AssignmentInputSchema, ClassTeacherInputSchema, type AssignmentInput, type ClassTeacherInput } from "./schema";
import { firstMessage, write, type Done } from "./write";

/**
 * Teaching (D-060): one teacher per subject in a class, and each class's Class Teacher. A section-scoped
 * Co-ordinator may only touch their own section's classes, and only pick their own section's teachers.
 */

/** One round trip: may the actor act on this class, and (if a teacher is named) may they pick this teacher? */
async function guarded(db: D1Database, actor: string, classId: string, teacherId: string | null): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT ${coordinatorForSection(1, classSection(2))} AND (?3 IS NULL OR ${teacherManageableBy(1, 3)}) AS ok`,
    )
    .bind(actor, classId, teacherId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

/**
 * Assigns a teacher to a subject in a class, or (teacherId null) removes the current assignment. Ends the
 * old active row and starts a new one in the same batch, so history is kept, not deleted.
 */
export async function setAssignment(db: D1Database, auditKey: string, actor: string, input: AssignmentInput): Promise<Done> {
  const parsed = AssignmentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { classId, offeringId, teacherId } = parsed.data;

  if (!(await guarded(db, actor, classId, teacherId))) return { ok: false, reason: "not_allowed" };

  const endOld = db
    .prepare(
      `UPDATE teacher_assignments SET is_active = 0
        WHERE is_active = 1
          AND class_id = (SELECT id FROM classes WHERE public_id = ?1)
          AND offering_id = (SELECT id FROM subject_offerings WHERE public_id = ?2)`,
    )
    .bind(classId, offeringId);

  if (teacherId === null) {
    const outcome = await write(
      db,
      auditKey,
      { action: "academics.assignment.removed", entityType: "teacher_assignment", entityPublicId: offeringId, actorPublicId: actor, summary: "Teaching assignment removed" },
      endOld,
    );
    return outcome === "done" ? { ok: true } : { ok: false, reason: "not_found" };
  }

  const publicId = newPublicId();
  const statements = [
    endOld,
    db
      .prepare(
        `INSERT INTO teacher_assignments (public_id, class_id, offering_id, teacher_user_id, created_at)
         SELECT ?1, c.id, o.id, u.id, ?5
           FROM classes c, subject_offerings o, users u
          WHERE c.public_id = ?2 AND o.public_id = ?3 AND u.public_id = ?4`,
      )
      .bind(publicId, classId, offeringId, teacherId, new Date().toISOString()),
  ];
  const outcome = await write(
    db,
    auditKey,
    { action: "academics.assignment.set", entityType: "teacher_assignment", entityPublicId: publicId, actorPublicId: actor, summary: "Teacher assigned to a subject in a class", after: { classId, offeringId, teacherId } },
    statements,
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That subject is not taught at this class's level" };
  return { ok: false, reason: "not_found" };
}

/** Sets or clears a class's Class Teacher. A teacher already Class Teacher of another class this year is 409. */
export async function setClassTeacher(db: D1Database, auditKey: string, actor: string, classId: string, teacherId: string | null): Promise<Done> {
  const parsed = ClassTeacherInputSchema.safeParse({ teacherId });
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  if (!(await guarded(db, actor, classId, parsed.data.teacherId))) return { ok: false, reason: "not_allowed" };

  const outcome = await write(
    db,
    auditKey,
    { action: "academics.class_teacher.set", entityType: "class", entityPublicId: classId, actorPublicId: actor, summary: parsed.data.teacherId ? "Class Teacher set" : "Class Teacher cleared", after: { teacherId: parsed.data.teacherId } },
    db
      .prepare(`UPDATE classes SET class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?2) WHERE public_id = ?1`)
      .bind(classId, parsed.data.teacherId),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_found" };
}
```
Add to `schema.ts`:
```ts
export const AssignmentInputSchema = z.strictObject({ classId: PublicIdSchema, offeringId: PublicIdSchema, teacherId: PublicIdSchema.nullable() }).openapi("AssignmentInput");
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>;
export const ClassTeacherInputSchema = z.strictObject({ teacherId: PublicIdSchema.nullable() }).openapi("ClassTeacherInput");
export type ClassTeacherInput = z.infer<typeof ClassTeacherInputSchema>;
```
`Failure`/`Done` in `write.ts` already has `"year_closed"` and `"conflict"`; no change needed there (both already exist per `write.ts` line 4).

Test first (`apps/api/test/teaching-service.test.ts`, copy `academics-classes.test.ts`'s harness — seed a year, two programmes/levels/classes across both sections, an offering per level, one teacher per section):
- `setAssignment` success: the Co-ordinator (institution and section-scoped, matching section) assigns a teacher to their own offering/class; a second call with a different teacher replaces it (old row `is_active = 0`, new one active, exactly one active row for the pair); `teacherId: null` removes it (no active row remains) and answers `ok: true`; removing when none exists is `not_found`.
- Refused: a section-scoped Co-ordinator on the other section's class is `not_allowed`; a section-scoped Co-ordinator naming a teacher of the other section is `not_allowed` even for their own class; an Accountant, Teacher, Student are `not_allowed`; an offering not on the class's level is `invalid` (message "not taught at this class's level"); a closed year's class is `year_closed`; a switched-off Co-ordinator with a stale grant is `not_allowed`.
- `setClassTeacher` success: sets, clears (`null`), and re-sets after clearing; a Super Admin may set any class's Class Teacher.
- Refused: the same teacher as Class Teacher of a second class in the same year is `conflict`; a class outside scope is `not_allowed`; a teacher outside scope is `not_allowed`; a closed year is `year_closed`.
- Audit: each successful call writes exactly one entry with the right `action`; a `teacherId: null` removal with nothing to remove writes none; `verifyAuditChain` passes after the whole run.
- Second school: the sample school's single section runs `setAssignment` and `setClassTeacher` the same way (no section restriction possible with one section, so this mainly proves nothing academics-specific broke for it).

- [ ] Write `teaching-service.test.ts` with the cases above (they will fail: no `teaching.ts` yet).
- [ ] Run: `cd apps/api && npx vitest run test/teaching-service.test.ts` — expect FAIL.
- [ ] Add `AssignmentInputSchema`/`ClassTeacherInputSchema` to `schema.ts`, `classSection` to `guard.ts` (Task 4), `teaching.ts` as above, `export * from "./teaching"` in `service.ts`.
- [ ] Run the test again — expect PASS.
- [ ] Commit: `git add apps/api/src/modules/academics/teaching.ts apps/api/src/modules/academics/guard.ts apps/api/src/modules/academics/schema.ts apps/api/src/modules/academics/service.ts apps/api/test/teaching-service.test.ts && git commit -m "Slice 3b: teaching assignments and Class Teacher service"`.

### Task 6: The read (`getTeaching`) and its schema
Files: `apps/api/src/modules/academics/queries.ts` (add), `apps/api/src/modules/academics/schema.ts` (add response shapes), `apps/api/src/modules/academics/index.ts` (export `getTeaching` and the `Teaching` type).

**Interfaces produced:** `getTeaching(db: D1Database, sections: "all" | readonly string[], classId: string): Promise<Teaching | null>`.

Add to `schema.ts`:
```ts
export const TeachableTeacherSchema = z.object({ id: z.string(), fullName: z.string() }).openapi("TeachableTeacher");
export const TeachingAssignmentSchema = z
  .object({ offeringId: z.string(), subjectName: z.string(), teacher: TeachableTeacherSchema.nullable() })
  .openapi("TeachingAssignment");
export const TeachingSchema = z
  .object({
    classId: z.string(),
    classLabel: z.string(),
    levelName: z.string(),
    classTeacher: TeachableTeacherSchema.nullable(),
    assignments: z.array(TeachingAssignmentSchema),
    /** The teachers this actor may pick from, for both dropdowns. */
    teachers: z.array(TeachableTeacherSchema),
  })
  .openapi("Teaching");
export type Teaching = z.infer<typeof TeachingSchema>;
```
Add to `queries.ts` (mirrors `getCurriculum`'s one-`batch()` shape, and mirrors `listStaff`'s teacher-visibility rule so the dropdown never offers a teacher the write would then refuse):
```ts
/**
 * One class's teaching: its offerings with their current teacher (or none), its Class Teacher, and the
 * teachers this viewer may pick from (institution-wide sees all teachers; section-scoped sees their own
 * section's). Null when the class does not exist or is outside the viewer's sections, same as a missing one.
 */
export async function getTeaching(db: D1Database, sections: "all" | readonly string[], classId: string): Promise<Teaching | null> {
  const [classResult, assignmentResult, teacherResult] = await db.batch([
    db
      .prepare(
        `SELECT c.public_id, c.label, l.name AS level_name, l.id AS level_id, tu.public_id AS ct_id, tu.full_name AS ct_name
           FROM classes c
           JOIN levels l ON l.id = c.level_id
           JOIN programmes p ON p.id = l.programme_id
           JOIN sections s ON s.id = p.section_id
           LEFT JOIN users tu ON tu.id = c.class_teacher_user_id
          WHERE c.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(classId, sectionFilter(sections)),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, s.name AS subject_name, tu.public_id AS teacher_id, tu.full_name AS teacher_name
           FROM subject_offerings o
           JOIN classes c ON c.level_id = o.level_id
           JOIN subjects s ON s.id = o.subject_id
           LEFT JOIN teacher_assignments ta ON ta.class_id = c.id AND ta.offering_id = o.id AND ta.is_active = 1
           LEFT JOIN users tu ON tu.id = ta.teacher_user_id
          WHERE c.public_id = ?1 AND o.is_active = 1
          ORDER BY s.name COLLATE NOCASE`,
      )
      .bind(classId),
    db
      .prepare(
        `SELECT DISTINCT u.public_id, u.full_name
           FROM users u
           JOIN role_assignments ra ON ra.user_id = u.id AND ra.is_active = 1 AND ra.role = 'teacher'
           JOIN classes c ON c.public_id = ?1
           JOIN levels l ON l.id = c.level_id JOIN programmes p ON p.id = l.programme_id JOIN sections s ON s.id = p.section_id
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = 1 AND (?2 = 1 OR sp.home_section_id = p.section_id)
          ORDER BY u.full_name COLLATE NOCASE`,
      )
      .bind(classId, sections === "all" ? 1 : 0),
  ]);

  const cls = classResult!.results[0] as { public_id: string; label: string; level_name: string; ct_id: string | null; ct_name: string | null } | undefined;
  if (!cls) return null;

  return {
    classId: cls.public_id,
    classLabel: cls.label,
    levelName: cls.level_name,
    classTeacher: cls.ct_id ? { id: cls.ct_id, fullName: cls.ct_name! } : null,
    assignments: (assignmentResult!.results as { offering_id: string; subject_name: string; teacher_id: string | null; teacher_name: string | null }[]).map((r) => ({
      offeringId: r.offering_id,
      subjectName: r.subject_name,
      teacher: r.teacher_id ? { id: r.teacher_id, fullName: r.teacher_name! } : null,
    })),
    teachers: (teacherResult!.results as { public_id: string; full_name: string }[]).map((r) => ({ id: r.public_id, fullName: r.full_name })),
  };
}
```
Note: `?2 = 1` for the "institution-wide sees everyone" branch reuses the same `sections === "all"` test the other queries already use via `sectionFilter`; when `sections` is a section-key array (never true institution-wide) the teacher list is filtered to the class's own section by `sp.home_section_id = p.section_id`, which is exactly `classSection`'s section since the class is fixed. A Co-ordinator scoped to a *different* section never reaches this row (the first query already returned null for a class outside their sections).

Test first (`apps/api/test/teaching-queries.test.ts` or add to `teaching-service.test.ts`): a level with two offerings, one assigned; returns both, one with a teacher and one `null`; a class outside the viewer's sections is `null`; the teacher list for an institution-wide viewer includes both sections' teachers, for a section-scoped viewer only their own; a class with no Class Teacher gives `classTeacher: null`; a switched-off offering is excluded (`o.is_active = 1`).

- [ ] Write the failing read tests.
- [ ] Run: `cd apps/api && npx vitest run test/teaching-service.test.ts` (or the split file) — expect FAIL.
- [ ] Add the schema and query above; export both from `queries.ts`, add `getTeaching`/`Teaching` to `academics/index.ts`.
- [ ] Run again — expect PASS.
- [ ] Commit: `git add apps/api/src/modules/academics/queries.ts apps/api/src/modules/academics/schema.ts apps/api/src/modules/academics/index.ts apps/api/test/teaching-*.test.ts && git commit -m "Slice 3b: the class's teaching, one round trip"`.

### Task 7: The routes and the contract
File: `apps/api/src/modules/academics/routes.ts` (add three routes at the end of `registerAcademics`, before its closing brace).
```ts
const VIEW_ASSIGNMENTS = { action: "setup.assignments.view" } as const;
const MANAGE_ASSIGNMENTS = { action: "setup.assignments.manage" } as const;

// --- Teaching -----------------------------------------------------------------------------------------
defineRoute(
  app,
  {
    method: "get",
    path: "/api/academics/classes/{id}/teaching",
    operationId: "get_teaching",
    tags: ["academics"],
    description: "One class's subjects with their current teacher, its Class Teacher, and the teachers the person may pick from. A class outside the person's sections is 404, the same as a missing one.",
    access: VIEW_ASSIGNMENTS,
    request: { params: IdParam },
    responses: { 200: { description: "The class's teaching", content: json(TeachingSchema) }, 404: { description: "No such class, or not one the person may see", content: json(ErrorSchema) } },
  },
  async (c) => {
    c.header("Cache-Control", "no-store");
    const teaching = await getTeaching(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("param").id);
    return teaching ? c.json(teaching, 200) : c.json({ error: "not_found" }, 404);
  },
);

defineRoute(
  app,
  {
    method: "post",
    path: "/api/academics/assignments",
    operationId: "set_assignment",
    tags: ["academics"],
    description: "Assigns a teacher to a subject in a class, or (teacherId null) removes the assignment. Ends any earlier assignment for the same subject in the same class.",
    access: MANAGE_ASSIGNMENTS,
    request: { body: { required: true, content: json(AssignmentInputSchema) } },
    responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
  },
  async (c) => {
    const result = await setAssignment(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
    return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
  },
);

defineRoute(
  app,
  {
    method: "post",
    path: "/api/academics/classes/{id}/class-teacher",
    operationId: "set_class_teacher",
    tags: ["academics"],
    description: "Sets or (teacherId null) clears a class's Class Teacher. A teacher already Class Teacher of another class this year is 409.",
    access: MANAGE_ASSIGNMENTS,
    request: { params: IdParam, body: { required: true, content: json(ClassTeacherInputSchema) } },
    responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
  },
  async (c) => {
    const result = await setClassTeacher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").teacherId);
    return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
  },
);
```
Add the three new imports (`AssignmentInputSchema`, `ClassTeacherInputSchema`, `TeachingSchema` from `./schema`; `getTeaching` from `./queries`; `setAssignment`, `setClassTeacher` from `./service`) to `routes.ts`'s existing import lines.

Test first (`apps/api/test/teaching-routes.test.ts`, copy `academics-routes.test.ts`'s harness): 401 signed out on all three; 403 for Student, Teacher, Accountant; the Co-ordinator (both scopes) and Super Admin succeed within scope; the Admin may `GET` but gets 403 on both `POST`s; section-scoped data-level tests — a +2 Co-ordinator gets 404 reading a Bachelor's class's teaching and 403 posting an assignment or a Class Teacher to it, even with a guessed class id; a Bachelor's-section teacher named in a +2 assignment is 403; `no-store` on the read; a repeat Class Teacher (already Class Teacher of another class this year) is 409; an offering of the wrong level is 422. Then `npm run gen:openapi` (from `apps/api`), `npm run gen:api` (from `apps/web`), the full API suite, `node scripts/check-boundaries.mjs` (from the repo root).

- [ ] Write the failing route tests.
- [ ] Run: `cd apps/api && npx vitest run test/teaching-routes.test.ts` — expect FAIL.
- [ ] Add the three routes and their imports to `routes.ts`.
- [ ] Run again — expect PASS.
- [ ] Run `cd apps/api && npm run gen:openapi`, then `cd apps/web && npm run gen:api`.
- [ ] Run `cd apps/api && npx vitest run` (full suite) and `node scripts/check-boundaries.mjs` from the repo root — expect all green.
- [ ] Commit: `git add apps/api/src/modules/academics/routes.ts apps/api/openapi.json apps/web/src/api/schema.ts apps/api/test/teaching-routes.test.ts && git commit -m "Slice 3b: the teaching routes and the regenerated contract"`.

### Task 8: The screens
Files: `apps/web/src/people/teaching-model.ts` (new), `apps/web/src/people/teaching-client.ts` (new), `apps/web/src/people/TeachingScreen.tsx` (new), `apps/web/src/app/portal/people/teaching/page.tsx` (new), `apps/web/src/people/PeopleTabs.tsx` (new, mirrors `SetupLayout.tsx`'s `SetupTabs`), `apps/web/src/app/portal/people/page.tsx` (wrap in the new tabs), `apps/web/src/shell/nav.ts` (no change: People already links to `/portal/people`, which now shows the sub-menu, same pattern as Setup), `apps/web/src/i18n/messages.ts` (add `people.tab.staff`, `people.tab.teaching`, `teaching.*` keys), `apps/web/test/page-weight-budget.json` (add the new page).

First run the `ui-ux-pro-max` searches (no `--persist`): sub-navigation with an underline for the current item (as slice 1's review found for Setup), a form of several small pickers saving on change (as the Curriculum screen's group dropdown does), and empty-state guidance for a class with no subjects.

**Interfaces consumed:** `Teaching` fields from `@/api/schema` (`components["schemas"]["Teaching"]`); `SchoolClass` from `@/setup/model` (already loaded by `loadClasses`, reused here to build a class picker); `Gate`/`useLoad` from `@/setup/useLoad`; `Button`, `Select`, `Notice`, `Badge` from `@/ui`.

`teaching-model.ts`:
```ts
import type { components } from "@/api/schema";

export type Teaching = components["schemas"]["Teaching"];
```

`teaching-client.ts` (mirrors `people/client.ts`):
```ts
import type { ApiClient } from "@/api/client";
import type { Teaching } from "./teaching-model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "not_found" | "failed" };
export type WriteResult = { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "rejected" | "conflict" | "failed" };

export async function loadTeaching(api: ApiClient, classId: string): Promise<Loaded<Teaching>> {
  try {
    const { data, response } = await api.GET("/api/academics/classes/{id}/teaching", { params: { path: { id: classId } } });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function reasonOf(status: number): WriteResult["reason"] {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

export async function setAssignment(api: ApiClient, classId: string, offeringId: string, teacherId: string | null): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/academics/assignments", { body: { classId, offeringId, teacherId } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function setClassTeacher(api: ApiClient, classId: string, teacherId: string | null): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/academics/classes/{id}/class-teacher", { params: { path: { id: classId } }, body: { teacherId } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
```

`PeopleTabs.tsx` (mirrors `SetupTabs`):
```tsx
"use client";
import Link from "next/link";
import { t } from "@/i18n/messages";
import setupStyles from "@/setup/setup.module.css";

export function PeopleTabs({ pathname }: { pathname: string }) {
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/people", label: t("people.tab.staff") },
    { href: "/portal/people/teaching", label: t("people.tab.teaching") },
  ];
  return (
    <nav aria-label={t("people.tabs")}>
      <ul className={setupStyles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} className={setupStyles.tab} aria-current={here === tab.href ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```
Reusing `setup.module.css`'s `.tabs`/`.tab` classes keeps the sub-nav visually identical to Setup's, per the design system (no new CSS needed). Both `apps/web/src/app/portal/people/page.tsx` and the new `teaching/page.tsx` render `<PeopleTabs pathname={usePathname()} />` above their content, same as `SetupLayout` does — but since only `people/page.tsx` currently exists standalone, give both new and existing pages a tiny local layout instead of a shared one (`SetupLayout` is `setup`-specific): add the tabs directly in each `page.tsx`, wrapped in `PortalShell`.

**`TeachingScreen.tsx`** — picks a class (reusing `loadClasses` from `@/setup/client`), then shows `getTeaching`'s answer: each offering with a `<Select>` of `teaching.teachers` (plus a "— none —" option) that calls `setAssignment` `onChange`; a `<Select>` for the Class Teacher (same teacher list) that calls `setClassTeacher` `onChange`; a plain-message flash on each save (`writing.md`: keep the action's own name, "Teacher assigned."/"Teacher removed."/"Class Teacher set."/"Class Teacher cleared."), matching D-057's fix for generic "Saved." messages. An empty class (no offerings) shows `people.teaching.empty` with a link to Curriculum, since Curriculum is where offerings are added (mirrors the D-057 fix: an empty state names the next step).

Messages to add to `apps/web/src/i18n/messages.ts`: `people.tab.staff`, `people.tab.teaching`, `people.tabs`, `people.teaching.title`, `people.teaching.intro`, `people.teaching.chooseClass`, `people.teaching.classTeacher`, `people.teaching.none`, `people.teaching.empty`, `people.teaching.done.assigned`, `people.teaching.done.removed`, `people.teaching.done.classTeacherSet`, `people.teaching.done.classTeacherCleared`, `people.teaching.error.conflict` ("Already Class Teacher of another class this year"), plus the existing `REASON_MESSAGE`-style keys reused from `people/model.ts` where the reasons overlap (`forbidden`, `not_found`, `failed`).

Test first (`apps/web/test/teaching-markup.test.ts`, copy `apps/web/test/people-markup.test.ts`'s `renderToStaticMarkup` approach): the class picker lists classes; each offering row shows its subject name and a teacher `<select>`; the Class Teacher picker is present once per screen, not per offering; a reader (no `setup.assignments.manage`) sees the data with disabled/no `<select>` (mirror how `StaffView` hides actions when `canManageMember` is false — add an equivalent `canManageTeaching(roles)` check to `teaching-model.ts` using the same `manageableSections` idea already in `@/setup/model`); the empty-class message and its link to Curriculum appear when `assignments` is empty; the guard test `apps/web/test/guards.test.ts` ("every message is used by some component") passes with the new keys (add the words and the screen in the same commit, per the slice 2 lesson).

- [ ] Write the failing markup test.
- [ ] Run: `cd apps/web && npx vitest run test/teaching-markup.test.ts` — expect FAIL.
- [ ] Add the message keys, `teaching-model.ts`, `teaching-client.ts`, `PeopleTabs.tsx`, `TeachingScreen.tsx`, the new `teaching/page.tsx`, and update `people/page.tsx` to include `PeopleTabs`.
- [ ] Run again — expect PASS.
- [ ] Run `cd apps/web && npx vitest run` (full suite, catches `guards.test.ts` and `page-weight.test.ts`) — add the new route to `page-weight-budget.json` if that test lists routes explicitly (check the file first).
- [ ] Commit: `git add apps/web/src/people apps/web/src/app/portal/people apps/web/src/i18n/messages.ts apps/web/test/teaching-markup.test.ts apps/web/test/page-weight-budget.json && git commit -m "Slice 3b: the Teaching screen and the People sub-menu"`.

### Task 9: See it work and review the design
- Local database: `cd apps/api && npm run provision -- --pack ../../packs/royal-softech --local` (adds the migration; re-run is safe, D-026).
- Start `web-dev` only (never `worker` if another chat's is already running, per the memory note); sign in as the PM's local Admin (read-only look) at `http://127.0.0.1:3000`.
- Check at 320 px wide with text at 200%: no sideways scroll on the Teaching screen with several subjects; every `<select>`/button at least 44 px; dark and light both read cleanly; no console errors.
- `apple-design` review: read (reuse from slice 1/2/3a's review, plus re-read if a new page type appears) `layout.md`, `feedback.md`, `writing.md`, `entering-data.md`, `text-fields.md` (for `<select>` guidance), `lists-and-tables.md`, `tab-bars.md` (for `PeopleTabs`), `accessibility.md`, `color.md`.
- Fix what the review finds; note what is left and why, same format as slices 1 to 3a's DECISIONS entries.
- I do not type passwords, so the actual assign/clear/class-teacher flows as a Co-ordinator are covered by the API, client and markup tests; ask the PM to try them with `setup-tester@school.example` / `plus2-tester@school.example`.

### Task 10: Prove it, log it, ship it
Mutation checks (each must fail a named test; use the slice 3a script style, `node mutate3b.mjs` filtering by id prefix):
1. Remove the `teacher_assignments_same_level` trigger — a wrong-level assignment must then succeed, and a test must catch it (Task 1's test).
2. Remove the `teacher_assignments_one_active` partial unique index — two active assignments for the same pair must then be possible, caught by Task 1's test.
3. Remove `classes_one_class_teacher_per_year` — a teacher as Class Teacher of two classes the same year must then succeed, caught by Task 1's test.
4. Widen `guarded()` to skip the teacher check (`?3 IS NULL OR true`) — a section-scoped Co-ordinator assigning another section's teacher must then succeed, caught by Task 5's test.
5. Widen `guarded()` to skip `coordinatorForSection` — a section-scoped Co-ordinator touching another section's class must then succeed, caught by Task 5's test.
6. Remove the closed-year triggers on `teacher_assignments` — a write to a closed year's class's assignment must then succeed, caught by Task 1's and Task 5's tests.
7. Change `getTeaching`'s teacher-list filter to always show every teacher — a section-scoped viewer must then see the other section's teachers, caught by Task 6's test.
8. Make `write`'s `onlyIfLastChanged` not apply to `setAssignment`/`setClassTeacher` — a no-op call must then still write an audit entry, caught by Task 5's "writes none" test.
9. Remove the `mu.public_id <> ?t` (or equivalent) reuse check — not applicable here (no self-assignment rule in this slice); skip.

Then:
- [ ] Log D-060 in `docs/DECISIONS.md` (built to, files touched, rules chosen while building — the "no requirement that a Class Teacher teach in the class" default — tested, found-and-fixed, design review, not verified by me, not done).
- [ ] Update `docs/data-model.md` (the `teacher_assignments` table and the new `classes` column) and the status lines in `CLAUDE.md` and project memory.
- [ ] Push the branch; replay CI in a fresh clone (`git clone`, `npm ci` at the root and in `apps/api`/`apps/web`, `npm run gen:openapi`/`gen:permissions`/`gen:api` drift checks, `node scripts/check-boundaries.mjs`, the full test suites, the production build).
- [ ] Open the PR; wait for 6 of 6 on the latest commit (read via `ccd_pr`, not by polling `gh`).
- [ ] **Ask the PM before merging** (their standing rule: approval for one PR does not carry to the next).

## Self-review notes (for whoever executes this)

- Spec coverage: migration and triggers (§6.2) → Task 1; `setup.assignments.view` (§6.2) → Task 2; section-scoped teacher/class rule (chat design) → Tasks 3–5; the read for the screen (chat design) → Task 6; the three routes (chat design) → Task 7; the Teaching screen and People sub-menu (§6.2, "no sub-menu until 3b adds Teaching" from D-059) → Task 8; design review, mutation checks, D-060, CI, PR → Tasks 9–10.
- The open design choice (Class Teacher need not teach in the class) is called out in Global Constraints and Task 10's DECISIONS entry, not decided silently.
- Type check: `AssignmentInput`/`ClassTeacherInput` (Task 5) match `AssignmentInputSchema`/`ClassTeacherInputSchema` (also Task 5); `Teaching`/`TeachingSchema` (Task 6) are the same names the routes (Task 7) and the web model (Task 8) import; `setAssignment`/`setClassTeacher` (Task 5) match the names the routes (Task 7) and the web client (Task 8) call.
