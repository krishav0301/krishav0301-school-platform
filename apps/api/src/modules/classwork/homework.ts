import { recordAudit } from "../../core/audit";
import { adToBsText, nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { CLASS_JOINS, TEACHES_SUBJECT, teachesRow } from "./guard";
import {
  ReviewWorkSchema,
  SetAssignmentSchema,
  type AssignmentDetail,
  type SetAssignment,
  type StudentAssignments,
  type TeacherAssignments,
} from "./schema";

/**
 * Homework (D-072). Source 6.2: deadline, instructions, an optional attachment (a link while R2 is off), late flagged
 * automatically, the teacher reviews with marks and feedback, resubmission is request-then-approve. One submission
 * per student and assignment; an allowed resubmission replaces its text, and the earlier text is kept in the audit
 * entry. Each write is one batch with its audit entry, and re-checks the person inside it (D-021).
 */

export const homeworkOn = `COALESCE((SELECT enabled FROM module_switches WHERE key = 'homework'), 1) = 1`;

type Failure = { ok: false; reason: "not_found" | "year_closed" | "conflict" } | { ok: false; reason: "invalid"; message: string };
export type HomeworkWrite = { ok: true } | Failure;
export type HomeworkCreate = { ok: true; publicId: string } | Failure;
const invalid = (message: string): Failure => ({ ok: false, reason: "invalid", message });

/** Runs the business statements and the audit entry as one batch; the database's refusals become reasons. */
async function audited(db: D1Database, auditKey: string, event: Parameters<typeof recordAudit>[2], statements: D1PreparedStatement[]): Promise<"done" | "not_applied" | "year_closed" | "duplicate"> {
  try {
    const { applied } = await recordAudit(db, auditKey, event, statements, { onlyIfLastChanged: true });
    return applied ? "done" : "not_applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return "year_closed";
    if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
    throw error;
  }
}

// --- The teacher ---------------------------------------------------------------------------------

export async function setAssignment(db: D1Database, auditKey: string, me: string, input: SetAssignment, now = new Date()): Promise<HomeworkCreate> {
  const parsed = SetAssignmentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "That is not valid");
  const { classId, offeringId, title, instructions, maxMarks } = parsed.data;
  const dueAt = new Date(parsed.data.dueAt).toISOString();
  if (dueAt <= now.toISOString()) return invalid("The deadline must be in the future");

  const check = await db
    .prepare(`SELECT (${homeworkOn}) AS on_, ay.status FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u WHERE ${TEACHES_SUBJECT}`)
    .bind(me, classId, offeringId)
    .first<{ on_: number; status: string }>();
  if (!check || check.on_ !== 1 || (check.status !== "active" && check.status !== "closed")) return { ok: false, reason: "not_found" };
  if (check.status === "closed") return { ok: false, reason: "year_closed" };

  const publicId = newPublicId();
  const outcome = await audited(
    db,
    auditKey,
    { action: "assignments.set", entityType: "assignment", entityPublicId: publicId, actorPublicId: me, summary: `Assignment set: ${title}`, after: { classId, offeringId, title, dueAt, maxMarks: maxMarks ?? null } },
    [
      db
        .prepare(
          `INSERT INTO assignments (public_id, class_id, offering_id, title, instructions, link, due_at, max_marks, teacher_user_id, created_at)
           SELECT ?4, cl.id, o.id, ?5, ?6, ?7, ?8, ?9, u.id, ?10
             FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id, subject_offerings o, users u
            WHERE ${TEACHES_SUBJECT} AND ay.status = 'active' AND ${homeworkOn}`,
        )
        .bind(me, classId, offeringId, publicId, title, instructions, parsed.data.link || null, dueAt, maxMarks ?? null, now.toISOString()),
    ],
  );
  if (outcome === "done") return { ok: true, publicId };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "not_found" };
}

export async function withdrawAssignment(db: D1Database, auditKey: string, me: string, assignmentId: string, now = new Date()): Promise<HomeworkWrite> {
  const outcome = await audited(db, auditKey, { action: "assignments.withdrawn", entityType: "assignment", entityPublicId: assignmentId, actorPublicId: me, summary: "Assignment withdrawn" }, [
    db
      .prepare(
        `UPDATE assignments SET withdrawn_at = ?3, withdrawn_by_user_id = (SELECT id FROM users WHERE public_id = ?1)
          WHERE public_id = ?2 AND withdrawn_at IS NULL AND ${homeworkOn} AND ${teachesRow(1, "assignments")}`,
      )
      .bind(me, assignmentId, now.toISOString()),
  ]);
  if (outcome === "done") return { ok: true };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "not_found" };
}

/** A submission of an assignment the teacher `?1` teaches: the assignment `?2`, the submission `?3`. */
const TEACHERS_SUBMISSION = `submissions.public_id = ?3 AND submissions.assignment_id = (SELECT a.id FROM assignments a WHERE a.public_id = ?2 AND a.withdrawn_at IS NULL AND ${teachesRow(1, "a")})`;

export async function reviewSubmission(db: D1Database, auditKey: string, me: string, assignmentId: string, submissionId: string, input: { marks?: number; feedback?: string }, now = new Date()): Promise<HomeworkWrite> {
  const parsed = ReviewWorkSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "That is not valid");
  const { marks } = parsed.data;
  const feedback = parsed.data.feedback ? parsed.data.feedback : null;

  const assignment = await db.prepare(`SELECT max_marks FROM assignments WHERE public_id = ?1`).bind(assignmentId).first<{ max_marks: number | null }>();
  if (!assignment) return { ok: false, reason: "not_found" };
  if (marks !== undefined && assignment.max_marks === null) return invalid("This assignment has no marks");
  if (marks !== undefined && marks > assignment.max_marks!) return invalid(`Marks cannot be more than ${assignment.max_marks}`);

  const outcome = await audited(
    db,
    auditKey,
    { action: "assignments.reviewed", entityType: "submission", entityPublicId: submissionId, actorPublicId: me, summary: "Submission reviewed", after: { marks: marks ?? null, feedback } },
    [
      db
        .prepare(
          `UPDATE submissions SET status = 'reviewed', marks = ?4, feedback = ?5, reviewed_at = ?6, updated_at = ?6
            WHERE ${TEACHERS_SUBMISSION} AND status IN ('submitted', 'reviewed') AND ${homeworkOn}`,
        )
        .bind(me, assignmentId, submissionId, marks ?? null, feedback, now.toISOString()),
    ],
  );
  if (outcome === "done") return { ok: true };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "not_found" };
}

/** Allows or declines a student's request to resubmit. Declined, the submission goes back to how it was. */
export async function decideResubmission(db: D1Database, auditKey: string, me: string, assignmentId: string, submissionId: string, allow: boolean, now = new Date()): Promise<HomeworkWrite> {
  const outcome = await audited(
    db,
    auditKey,
    { action: allow ? "assignments.resubmit_allowed" : "assignments.resubmit_declined", entityType: "submission", entityPublicId: submissionId, actorPublicId: me, summary: allow ? "Resubmission allowed" : "Resubmission declined" },
    [
      db
        .prepare(
          `UPDATE submissions
              SET status = CASE WHEN ?4 = 1 THEN 'resubmit_allowed' WHEN reviewed_at IS NOT NULL THEN 'reviewed' ELSE 'submitted' END,
                  resubmit_reason = CASE WHEN ?4 = 1 THEN resubmit_reason ELSE NULL END, updated_at = ?5
            WHERE ${TEACHERS_SUBMISSION} AND status = 'resubmit_requested' AND ${homeworkOn}`,
        )
        .bind(me, assignmentId, submissionId, allow ? 1 : 0, now.toISOString()),
    ],
  );
  if (outcome === "done") return { ok: true };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "not_found" };
}

// --- The student ---------------------------------------------------------------------------------

/** The student's own enrollment in the class the assignment belongs to, this active year. `?1` the student's sign-in, `?2` the assignment. */
const MY_ENROLLMENT = `(SELECT en.id FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
                         JOIN assignments a ON a.class_id = en.class_id
                        WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND a.public_id = ?2 AND a.withdrawn_at IS NULL
                          AND en.status = 'active' AND ay.status IN ('active', 'closed'))`;

export async function submitWork(db: D1Database, auditKey: string, me: string, assignmentId: string, body: string, now = new Date()): Promise<HomeworkWrite> {
  const text = body.trim();
  if (!text || text.length > 10000) return invalid("Write your answer, up to 10,000 characters");
  const state = await db
    .prepare(
      `SELECT (${homeworkOn}) AS on_, ay.status AS year_status, sb.status, sb.body, sb.public_id AS submission_id
         FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id
         LEFT JOIN submissions sb ON sb.enrollment_id = en.id AND sb.assignment_id = (SELECT id FROM assignments WHERE public_id = ?2)
        WHERE en.id = ${MY_ENROLLMENT}`,
    )
    .bind(me, assignmentId)
    .first<{ on_: number; year_status: string; status: string | null; body: string | null; submission_id: string | null }>();
  if (!state || state.on_ !== 1) return { ok: false, reason: "not_found" };
  if (state.year_status === "closed") return { ok: false, reason: "year_closed" };
  const at = now.toISOString();

  if (state.status === null) {
    const publicId = newPublicId();
    const outcome = await audited(db, auditKey, { action: "assignments.submitted", entityType: "submission", entityPublicId: publicId, actorPublicId: me, summary: "Work submitted", after: { assignmentId } }, [
      db
        .prepare(
          `INSERT INTO submissions (public_id, assignment_id, enrollment_id, body, submitted_at, is_late, status, updated_at)
           SELECT ?3, a.id, ${MY_ENROLLMENT}, ?4, ?5, CASE WHEN ?5 > a.due_at THEN 1 ELSE 0 END, 'submitted', ?5
             FROM assignments a WHERE a.public_id = ?2 AND ${MY_ENROLLMENT} IS NOT NULL AND ${homeworkOn}`,
        )
        .bind(me, assignmentId, publicId, text, at),
    ]);
    if (outcome === "done") return { ok: true };
    if (outcome === "duplicate") return { ok: false, reason: "conflict" };
    return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "not_found" };
  }

  if (state.status !== "resubmit_allowed") return { ok: false, reason: "conflict" };
  const outcome = await audited(
    db,
    auditKey,
    { action: "assignments.resubmitted", entityType: "submission", entityPublicId: state.submission_id!, actorPublicId: me, summary: "Work resubmitted", before: { body: state.body } },
    [
      db
        .prepare(
          `UPDATE submissions
              SET body = ?3, submitted_at = ?4, is_late = CASE WHEN ?4 > (SELECT due_at FROM assignments WHERE id = submissions.assignment_id) THEN 1 ELSE 0 END,
                  status = 'submitted', marks = NULL, feedback = NULL, reviewed_at = NULL, resubmit_reason = NULL, attempts = attempts + 1, updated_at = ?4
            WHERE enrollment_id = ${MY_ENROLLMENT} AND assignment_id = (SELECT id FROM assignments WHERE public_id = ?2) AND status = 'resubmit_allowed' AND ${homeworkOn}`,
        )
        .bind(me, assignmentId, text, at),
    ],
  );
  if (outcome === "done") return { ok: true };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "conflict" };
}

export async function requestResubmission(db: D1Database, auditKey: string, me: string, assignmentId: string, reason: string, now = new Date()): Promise<HomeworkWrite> {
  const text = reason.trim();
  if (!text || text.length > 500) return invalid("Say why, in up to 500 characters");
  const exists = await db
    .prepare(`SELECT sb.status FROM submissions sb WHERE sb.enrollment_id = ${MY_ENROLLMENT} AND sb.assignment_id = (SELECT id FROM assignments WHERE public_id = ?2)`)
    .bind(me, assignmentId)
    .first<{ status: string }>();
  if (!exists) return { ok: false, reason: "not_found" };
  const outcome = await audited(db, auditKey, { action: "assignments.resubmit_requested", entityType: "assignment", entityPublicId: assignmentId, actorPublicId: me, summary: "Resubmission requested", reason: text }, [
    db
      .prepare(
        `UPDATE submissions SET status = 'resubmit_requested', resubmit_reason = ?3, updated_at = ?4
          WHERE enrollment_id = ${MY_ENROLLMENT} AND assignment_id = (SELECT id FROM assignments WHERE public_id = ?2) AND status IN ('submitted', 'reviewed') AND ${homeworkOn}`,
      )
      .bind(me, assignmentId, text, now.toISOString()),
  ]);
  if (outcome === "done") return { ok: true };
  return { ok: false, reason: outcome === "year_closed" ? "year_closed" : "conflict" };
}

// --- Reads -----------------------------------------------------------------------------------------

export type HomeworkRead<T> = { ok: true; data: T } | { ok: false; reason: "off" | "not_found" };
const isOn = async (db: D1Database) => (await db.prepare(`SELECT (${homeworkOn}) AS on_`).first<{ on_: number }>())!.on_ === 1;

interface SubmissionRow {
  sb_id: string | null;
  sb_status: "submitted" | "reviewed" | "resubmit_requested" | "resubmit_allowed";
  sb_is_late: number;
  sb_body: string;
  sb_submitted_at: string;
  sb_marks: number | null;
  sb_feedback: string | null;
  sb_reason: string | null;
  sb_attempts: number;
}
const SUBMISSION_COLUMNS = `sb.public_id AS sb_id, sb.status AS sb_status, sb.is_late AS sb_is_late, sb.body AS sb_body, sb.submitted_at AS sb_submitted_at,
                            sb.marks AS sb_marks, sb.feedback AS sb_feedback, sb.resubmit_reason AS sb_reason, sb.attempts AS sb_attempts`;
const submissionOf = (r: SubmissionRow) =>
  r.sb_id === null
    ? null
    : { id: r.sb_id, status: r.sb_status, isLate: r.sb_is_late === 1, body: r.sb_body, submittedAt: r.sb_submitted_at, marks: r.sb_marks, feedback: r.sb_feedback, resubmitReason: r.sb_reason, attempts: r.sb_attempts };

interface AssignmentRow {
  public_id: string;
  title: string;
  instructions: string;
  link: string | null;
  due_at: string;
  max_marks: number | null;
  subject_name: string;
}
const assignmentOf = (r: AssignmentRow) => ({
  id: r.public_id,
  title: r.title,
  instructions: r.instructions,
  link: r.link,
  dueAt: r.due_at,
  dueDateBs: adToBsText(nepalDate(new Date(r.due_at))),
  maxMarks: r.max_marks,
  subjectName: r.subject_name,
});
const ASSIGNMENT_COLUMNS = `a.public_id, a.title, a.instructions, a.link, a.due_at, a.max_marks, sbj.name AS subject_name`;

/** The teacher's assignments in subjects they teach this year, newest deadline first, with counts. */
export async function teacherAssignments(db: D1Database, me: string): Promise<HomeworkRead<TeacherAssignments>> {
  if (!(await isOn(db))) return { ok: false, reason: "off" };
  const { results } = await db
    .prepare(
      `SELECT ${ASSIGNMENT_COLUMNS}, a.withdrawn_at, cl.public_id AS class_id, pv.name AS programme_name, lv.name AS level_name, cl.label,
              (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = a.class_id AND en.status = 'active') AS students,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submitted,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'submitted') AS to_review,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'resubmit_requested') AS requests
         FROM assignments a JOIN classes cl ON cl.id = a.class_id ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
         JOIN subject_offerings o ON o.id = a.offering_id JOIN subjects sbj ON sbj.id = o.subject_id
        WHERE ay.status = 'active' AND ${teachesRow(1, "a")}
        ORDER BY a.due_at DESC
        LIMIT 200`,
    )
    .bind(me)
    .all<AssignmentRow & { withdrawn_at: string | null; class_id: string; programme_name: string; level_name: string; label: string; students: number; submitted: number; to_review: number; requests: number }>();
  return {
    ok: true,
    data: {
      assignments: results.map((r) => ({
        ...assignmentOf(r),
        classId: r.class_id,
        programmeName: r.programme_name,
        levelName: r.level_name,
        label: r.label,
        withdrawn: r.withdrawn_at !== null,
        students: r.students,
        submitted: r.submitted,
        toReview: r.to_review,
        requests: r.requests,
      })),
    },
  };
}

/** One assignment for its teacher: every student of the class, with their submission or none. */
export async function assignmentDetail(db: D1Database, me: string, assignmentId: string): Promise<HomeworkRead<AssignmentDetail>> {
  const [on, head, roster] = await db.batch([
    db.prepare(`SELECT (${homeworkOn}) AS on_`),
    db
      .prepare(
        `SELECT ${ASSIGNMENT_COLUMNS}, a.withdrawn_at, cl.public_id AS class_id, pv.name AS programme_name, lv.name AS level_name, cl.label
           FROM assignments a JOIN classes cl ON cl.id = a.class_id ${CLASS_JOINS}
           JOIN subject_offerings o ON o.id = a.offering_id JOIN subjects sbj ON sbj.id = o.subject_id
          WHERE a.public_id = ?2 AND ${teachesRow(1, "a")}`,
      )
      .bind(me, assignmentId),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, st.sid, st.first_name, st.last_name, ${SUBMISSION_COLUMNS}
           FROM assignments a JOIN enrollments en ON en.class_id = a.class_id JOIN students st ON st.id = en.student_id
           LEFT JOIN submissions sb ON sb.assignment_id = a.id AND sb.enrollment_id = en.id
          WHERE a.public_id = ?1 AND (en.status = 'active' OR sb.id IS NOT NULL)
          ORDER BY en.roll_no IS NULL, en.roll_no, st.first_name, st.last_name`,
      )
      .bind(assignmentId),
  ]);
  if ((on!.results[0] as { on_: number }).on_ !== 1) return { ok: false, reason: "off" };
  const row = head!.results[0] as (AssignmentRow & { withdrawn_at: string | null; class_id: string; programme_name: string; level_name: string; label: string }) | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const students = (roster!.results as unknown as (SubmissionRow & { enrollment_id: string; sid: string; first_name: string; last_name: string })[]).map((r) => ({
    enrollmentId: r.enrollment_id,
    sid: r.sid,
    name: `${r.first_name} ${r.last_name}`,
    submission: submissionOf(r),
  }));
  return {
    ok: true,
    data: { ...assignmentOf(row), classId: row.class_id, programmeName: row.programme_name, levelName: row.level_name, label: row.label, withdrawn: row.withdrawn_at !== null, students },
  };
}

/** The student's own class's live assignments, newest deadline first, each with their own submission. Found from the sign-in. */
export async function studentAssignments(db: D1Database, me: string): Promise<HomeworkRead<StudentAssignments>> {
  if (!(await isOn(db))) return { ok: false, reason: "off" };
  const { results } = await db
    .prepare(
      `SELECT ${ASSIGNMENT_COLUMNS}, tu.full_name AS teacher_name, ${SUBMISSION_COLUMNS}
         FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
         JOIN assignments a ON a.class_id = en.class_id AND a.withdrawn_at IS NULL
         JOIN subject_offerings o ON o.id = a.offering_id JOIN subjects sbj ON sbj.id = o.subject_id JOIN users tu ON tu.id = a.teacher_user_id
         LEFT JOIN submissions sb ON sb.assignment_id = a.id AND sb.enrollment_id = en.id
        WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND ay.status = 'active' AND en.status = 'active'
        ORDER BY a.due_at DESC
        LIMIT 200`,
    )
    .bind(me)
    .all<AssignmentRow & SubmissionRow & { teacher_name: string }>();
  return { ok: true, data: { assignments: results.map((r) => ({ ...assignmentOf(r), teacherName: r.teacher_name, submission: submissionOf(r) })) } };
}
