import { teacherManageableBy } from "../accounts/service";
import { newPublicId } from "../../core/ids";
import { classSection, coordinatorForSection } from "./guard";
import { AssignmentInputSchema, ClassTeacherInputSchema, type AssignmentInput } from "./schema";
import { firstMessage, write, type Done } from "./write";

/**
 * Teaching (D-060): one teacher per subject in a class, and each class's Class Teacher. A section-scoped
 * Co-ordinator may only touch their own section's classes, and only pick their own section's teachers
 * (`teacherManageableBy`, shared with `accounts` since it is the same rule as who may manage a teacher).
 */

/** One round trip: may the actor act on this class, and (if a teacher is named) may they pick this teacher? */
async function guarded(db: D1Database, actor: string, classId: string, teacherId: string | null): Promise<boolean> {
  const row = await db
    .prepare(`SELECT (${coordinatorForSection(1, classSection(2))}) AND (?3 IS NULL OR ${teacherManageableBy(1, 3)}) AS ok`)
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
    {
      action: "academics.assignment.set",
      entityType: "teacher_assignment",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: "Teacher assigned to a subject in a class",
      after: { classId, offeringId, teacherId },
    },
    statements,
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That subject is not taught at this class's level" };
  return { ok: false, reason: "not_found" };
}

/** Sets or clears a class's Class Teacher. A teacher already Class Teacher of another class this year is a conflict. */
export async function setClassTeacher(db: D1Database, auditKey: string, actor: string, classId: string, teacherId: string | null): Promise<Done> {
  const parsed = ClassTeacherInputSchema.safeParse({ teacherId });
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };

  if (!(await guarded(db, actor, classId, parsed.data.teacherId))) return { ok: false, reason: "not_allowed" };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.class_teacher.set",
      entityType: "class",
      entityPublicId: classId,
      actorPublicId: actor,
      summary: parsed.data.teacherId ? "Class Teacher set" : "Class Teacher cleared",
      after: { teacherId: parsed.data.teacherId },
    },
    db.prepare(`UPDATE classes SET class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?2) WHERE public_id = ?1`).bind(classId, parsed.data.teacherId),
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_found" };
}
