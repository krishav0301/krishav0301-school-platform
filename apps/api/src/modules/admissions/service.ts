/**
 * Admissions and the student record (Phase 4, D-063).
 *
 * One `applications` row carries a submission from first apply to a final decision, whether it came
 * from the public form, a Co-ordinator's walk-in (auto-approved), or an Accountant's registration
 * (goes to the queue like a public one). Approval is the one place that creates real, permanent
 * records (Student, the login User, the first Enrollment) and assigns the SID, all in one batch.
 *
 * Every write re-checks the actor INSIDE its own SQL (never the token, D-021), and the FIRST
 * mutating statement of `approve` carries the whole guard (actor, application state, class match);
 * every statement after it is chained by SQLite's `changes()`, so a disallowed or mistimed call
 * changes nothing at all, not just the last step (the lesson of D-061's two real bugs).
 */
import { newPublicId } from "../../core/ids";
import { hashPassword } from "../../core/passwords";
import { generateTemporaryPassword } from "../../core/temporary-password";
import { newRefreshToken, sha256Hex } from "../../core/tokens";
import { queueEmail } from "../../core/notifications";
import { accountantAnywhere, applicationSection, coordinatorForSection } from "./guard";
import { CorrectStudentSchema, type CorrectStudent } from "./schema";
import {
  ApplySchema,
  RejectSchema,
  RequestChangesSchema,
  WalkInSchema,
  type ApplicantDetails,
  type ApplyInput,
  type ApproveInput,
  type RejectInput,
  type RequestChanges,
  type WalkInInput,
} from "./schema";
import { write } from "./write";

const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const WINDOW_MINUTES = 15;
const VERIFY_HOURS = 24;

export type WriteFailure = { ok: false; reason: "not_allowed" | "not_found" };
export type Invalid = { ok: false; reason: "invalid"; message: string };
const firstMessage = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? "That is not valid";

// --- Duplicate check (D-006: phone, or name plus date of birth; advisory, never blocks) ------------

async function findDuplicateFlags(db: D1Database, phone: string, firstName: string, lastName: string, dob: string): Promise<string[]> {
  const [byPhone, byNameDob] = await db.batch([
    db.prepare(
      `SELECT 1 FROM students WHERE phone = ?1
       UNION SELECT 1 FROM applications WHERE phone = ?1 AND status NOT IN ('rejected', 'expired') LIMIT 1`,
    ).bind(phone),
    db.prepare(
      `SELECT 1 FROM students WHERE first_name = ?1 COLLATE NOCASE AND last_name = ?2 COLLATE NOCASE AND dob_ad = ?3
       UNION SELECT 1 FROM applications WHERE first_name = ?1 COLLATE NOCASE AND last_name = ?2 COLLATE NOCASE AND dob_ad = ?3 AND status NOT IN ('rejected', 'expired') LIMIT 1`,
    ).bind(firstName, lastName, dob),
  ]);
  const flags: string[] = [];
  if (byPhone!.results.length > 0) flags.push("phone");
  if (byNameDob!.results.length > 0) flags.push("name_dob");
  return flags;
}

/** The students a new walk-in may already be (same phone, or same name and date of birth), named for the Co-ordinator. */
async function findDuplicateStudents(db: D1Database, phone: string, firstName: string, lastName: string, dob: string): Promise<{ name: string; sid: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT first_name || ' ' || last_name AS name, sid FROM students
        WHERE phone = ?1 OR (first_name = ?2 COLLATE NOCASE AND last_name = ?3 COLLATE NOCASE AND dob_ad = ?4)
        ORDER BY sid LIMIT 5`,
    )
    .bind(phone, firstName, lastName, dob)
    .all<{ name: string; sid: string }>();
  return results;
}

// --- The public application --------------------------------------------------------------------------

export type ApplyResult = { ok: true; publicId: string } | { ok: false; reason: "throttled" } | WriteFailure | Invalid;

/** Anonymous. Rate limited, a submission token makes a retry idempotent, and a filled honeypot field is a silent no-op. */
export async function applyForAdmission(db: D1Database, dataKey: string, input: ApplyInput, ip: string, now: Date = new Date()): Promise<ApplyResult> {
  if (input.website) return { ok: true, publicId: newPublicId() }; // honeypot: never reveal it was tripped

  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;
  const email = p.email.trim().toLowerCase();

  const existing = await db.prepare("SELECT public_id FROM applications WHERE submission_token = ?1").bind(p.submissionToken).first<{ public_id: string }>();
  if (existing) return { ok: true, publicId: existing.public_id }; // the same click or a retried request: no new row, no new rate-limit count

  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  const [emailCount, ipCount] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM application_submission_events WHERE email = ?1 AND at > ?2").bind(email, since),
    db.prepare("SELECT COUNT(*) AS n FROM application_submission_events WHERE ip = ?1 AND at > ?2").bind(ip, since),
  ]);
  if ((emailCount!.results[0] as { n: number }).n >= EMAIL_LIMIT || (ipCount!.results[0] as { n: number }).n >= IP_LIMIT) return { ok: false, reason: "throttled" };

  const level = await db
    .prepare(
      `SELECT lv.id, lv.programme_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id
        WHERE lv.public_id = ?1 AND lv.is_active = 1 AND pv.is_active = 1`,
    )
    .bind(p.levelId)
    .first<{ id: number; programme_id: number }>();
  if (!level) return { ok: false, reason: "not_found" };
  const year = await db.prepare("SELECT id FROM academic_years WHERE status = 'active'").first<{ id: number }>();
  if (!year) return { ok: false, reason: "not_found" };

  const duplicateFlags = await findDuplicateFlags(db, p.phone, p.firstName, p.lastName, p.dob);

  const publicId = newPublicId();
  const token = newRefreshToken();
  const tokenHash = await sha256Hex(token);
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + VERIFY_HOURS * 3_600_000).toISOString();

  await db.batch([
    db.prepare("INSERT INTO application_submission_events (at, ip, email) VALUES (?1, ?2, ?3)").bind(at, ip, email),
    db
      .prepare(
        `INSERT INTO applications
           (public_id, submission_token, status, walk_in, first_name, middle_name, last_name, dob_ad, phone, email,
            guardian_name, guardian_phone, previous_school, referred_by, programme_id, level_id, academic_year_id,
            verification_token_hash, verification_expires_at, submitted_ip, duplicate_flags, created_at, updated_at)
         VALUES (?1, ?2, 'email_unverified', 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)`,
      )
      .bind(
        publicId, p.submissionToken, p.firstName, p.middleName ?? null, p.lastName, p.dob, p.phone, email,
        p.guardianName, p.guardianPhone, p.previousSchool ?? null, p.referredBy ?? null, level.programme_id, level.id,
        year.id, tokenHash, expiresAt, ip, JSON.stringify(duplicateFlags), at,
      ),
    await queueEmail(db, dataKey, { template: "admission_verify", to: email, data: { token }, dedupeKey: `admission-verify:${publicId}` }),
  ]);

  return { ok: true, publicId };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "invalid_or_expired" };

/** Confirms the email address and puts the application in the Co-ordinator's queue. */
export async function verifyApplicationEmail(db: D1Database, token: string, now: Date = new Date()): Promise<VerifyResult> {
  const tokenHash = await sha256Hex(token);
  const at = now.toISOString();
  const { meta } = await db
    .prepare(
      `UPDATE applications SET status = 'pending_review', email_verified_at = ?2, verification_token_hash = NULL, updated_at = ?2
        WHERE verification_token_hash = ?1 AND status = 'email_unverified' AND verification_expires_at > ?2`,
    )
    .bind(tokenHash, at)
    .run();
  return meta.changes > 0 ? { ok: true } : { ok: false, reason: "invalid_or_expired" };
}

/**
 * The cleanup sweep (D-063): an application that never got its email verified in time is marked
 * `expired`, the same status the duplicate check already excludes, so an abandoned attempt stops
 * flagging every later real applicant who shares its phone or name and date of birth. No actor and
 * no audit entry, matching `applyForAdmission` and `verifyApplicationEmail` — this touches only an
 * anonymous, pre-account row, and it is not a staff decision. Called from the existing 5-minute
 * cron sweep alongside the outbox (`src/index.ts`); needs no cron of its own.
 */
export async function expireStaleApplications(db: D1Database, now: Date = new Date()): Promise<{ expired: number }> {
  const { meta } = await db
    .prepare(`UPDATE applications SET status = 'expired', updated_at = ?1 WHERE status = 'email_unverified' AND verification_expires_at <= ?1`)
    .bind(now.toISOString())
    .run();
  return { expired: meta.changes ?? 0 };
}

// --- Staff-entered applications --------------------------------------------------------------------

export type RegisterResult = { ok: true; publicId: string } | WriteFailure | Invalid | { ok: false; reason: "already_resolved" };
/** A walk-in is auto-approved in the same request, so it carries what `approveApplication` returns: the SID and the
 * one-time temporary password the Co-ordinator must hand the student standing in front of them. */
export type WalkInResult =
  | { ok: true; publicId: string; sid: string; temporaryPassword: string }
  | WriteFailure
  | Invalid
  | { ok: false; reason: "already_resolved" }
  | { ok: false; reason: "possible_duplicate"; matches: { name: string; sid: string }[] };

/** The Co-ordinator's walk-in: auto-approved (D-021 domain rule), placed straight into a class. */
export async function registerWalkIn(
  db: D1Database,
  auditKey: string,
  dataKey: string,
  actor: string,
  input: WalkInInput & { classId: string; confirmDuplicate?: boolean },
  now: Date = new Date(),
): Promise<WalkInResult> {
  // ApplicantDetailsSchema is strict: classId is approve's, and confirmDuplicate this function's, not the applicant's.
  const { classId, confirmDuplicate, ...applicantOnly } = input;
  // The duplicate check stays advisory (D-006), but a walk-in is admitted at once, so the Co-ordinator sees who it may
  // already be and admits only on a second, deliberate "Admit anyway" (Co-ordinator FUT F-03).
  if (!confirmDuplicate) {
    const parsed = WalkInSchema.safeParse(applicantOnly);
    if (parsed.success) {
      const matches = await findDuplicateStudents(db, parsed.data.phone, parsed.data.firstName, parsed.data.lastName, parsed.data.dob);
      if (matches.length > 0) return { ok: false, reason: "possible_duplicate", matches };
    }
  }
  // Checked before anything is written, so a walk-in that cannot be admitted is not left behind in the queue (D-108): the
  // class must be open and of the chosen level, and the email must not already sign someone in.
  const parsedLevel = WalkInSchema.safeParse(applicantOnly);
  if (parsedLevel.success) {
    const ready = await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM classes cl JOIN levels lv ON lv.id = cl.level_id WHERE cl.public_id = ?1 AND lv.public_id = ?2 AND cl.is_active = 1) AS class_ok,
                EXISTS (SELECT 1 FROM users WHERE email = ?3) AS email_taken`,
      )
      .bind(classId, parsedLevel.data.levelId, parsedLevel.data.email.trim().toLowerCase())
      .first<{ class_ok: number; email_taken: number }>();
    if (ready?.class_ok !== 1) return { ok: false, reason: "invalid", message: CLASS_NOT_OPEN };
    if (ready.email_taken === 1) return { ok: false, reason: "invalid", message: EMAIL_TAKEN };
  }
  const registered = await registerApplication(db, auditKey, actor, "walkin", applicantOnly, now);
  if (!registered.ok) return registered;
  const approved = await approveApplication(db, auditKey, dataKey, actor, registered.publicId, { classId }, now);
  return approved.ok ? { ok: true, publicId: registered.publicId, sid: approved.sid, temporaryPassword: approved.temporaryPassword } : approved;
}

/** The Accountant's registration: goes to the queue like a public applicant who has verified their email. */
export async function registerStudent(db: D1Database, auditKey: string, actor: string, input: WalkInInput, now: Date = new Date()): Promise<RegisterResult> {
  return registerApplication(db, auditKey, actor, "accountant", input, now);
}

async function registerApplication(db: D1Database, auditKey: string, actor: string, kind: "walkin" | "accountant", input: WalkInInput, now: Date): Promise<RegisterResult> {
  const parsed = WalkInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p: ApplicantDetails = parsed.data;

  const level = await db
    .prepare(`SELECT lv.id, lv.programme_id, pv.section_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id WHERE lv.public_id = ?1 AND lv.is_active = 1 AND pv.is_active = 1`)
    .bind(p.levelId)
    .first<{ id: number; programme_id: number; section_id: number }>();
  if (!level) return { ok: false, reason: "not_found" };
  const year = await db.prepare("SELECT id FROM academic_years WHERE status = 'active'").first<{ id: number }>();
  if (!year) return { ok: false, reason: "not_found" };

  const duplicateFlags = await findDuplicateFlags(db, p.phone, p.firstName, p.lastName, p.dob);
  const publicId = newPublicId();
  const at = now.toISOString();
  // A literal, not user input: `level.section_id` was just read from the database, not the request.
  const actorGuard = kind === "walkin" ? coordinatorForSection(18, String(level.section_id)) : accountantAnywhere(18);

  const outcome = await write(
    db,
    auditKey,
    {
      action: kind === "walkin" ? "admissions.walkin.registered" : "admissions.student.registered",
      entityType: "application",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `${p.firstName} ${p.lastName} registered${kind === "walkin" ? " as a walk-in" : ""}`,
      after: { firstName: p.firstName, lastName: p.lastName, levelId: p.levelId },
    },
    [
      db
        .prepare(
          `INSERT INTO applications
             (public_id, status, walk_in, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name,
              guardian_phone, previous_school, referred_by, programme_id, level_id, academic_year_id, email_verified_at,
              duplicate_flags, created_at, updated_at)
           SELECT ?1, 'pending_review', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?16, ?16
             WHERE ${actorGuard}`,
        )
        .bind(
          publicId, kind === "walkin" ? 1 : 0, p.firstName, p.middleName ?? null, p.lastName, p.dob, p.phone,
          p.email.trim().toLowerCase(), p.guardianName, p.guardianPhone, p.previousSchool ?? null, p.referredBy ?? null,
          level.programme_id, level.id, year.id, at, JSON.stringify(duplicateFlags), actor,
        ),
    ],
  );

  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "check_failed") return { ok: false, reason: "not_found" };
  return { ok: false, reason: "not_allowed" };
}

// --- Review: ask for changes, reject, approve --------------------------------------------------------

export type DecideResult = { ok: true } | WriteFailure | { ok: false; reason: "already_resolved" };

export async function requestChanges(db: D1Database, auditKey: string, dataKey: string, actor: string, applicationPublicId: string, input: RequestChanges, now: Date = new Date()): Promise<DecideResult> {
  const parsed = RequestChangesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_allowed" };
  const p = parsed.data;
  const at = now.toISOString();

  const outcome = await write(
    db,
    auditKey,
    { action: "admissions.changes_requested", entityType: "application", entityPublicId: applicationPublicId, actorPublicId: actor, summary: `Changes requested: ${p.fields.join(", ")}`, after: p },
    [
      db
        .prepare(
          `UPDATE applications SET status = 'needs_changes', changes_requested = ?2, reviewed_by = (SELECT id FROM users WHERE public_id = ?3), updated_at = ?4
            WHERE public_id = ?1 AND status = 'pending_review' AND ${coordinatorForSection(3, applicationSection(1))}`,
        )
        .bind(applicationPublicId, JSON.stringify(p), actor, at),
    ],
  );
  if (outcome === "done") {
    await notifyDecision(db, dataKey, applicationPublicId, "needs_changes", p.reason);
    return { ok: true };
  }
  return await classifyDecideFailure(db, actor, applicationPublicId);
}

export async function reject(db: D1Database, auditKey: string, dataKey: string, actor: string, applicationPublicId: string, input: RejectInput, now: Date = new Date()): Promise<DecideResult> {
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_allowed" };
  const at = now.toISOString();

  const outcome = await write(
    db,
    auditKey,
    { action: "admissions.rejected", entityType: "application", entityPublicId: applicationPublicId, actorPublicId: actor, summary: `Rejected: ${parsed.data.reason}`, after: parsed.data },
    [
      db
        .prepare(
          `UPDATE applications SET status = 'rejected', decision_reason = ?2, reviewed_by = (SELECT id FROM users WHERE public_id = ?3), decided_at = ?4, updated_at = ?4
            WHERE public_id = ?1 AND status IN ('pending_review', 'needs_changes') AND ${coordinatorForSection(3, applicationSection(1))}`,
        )
        .bind(applicationPublicId, parsed.data.reason, actor, at),
    ],
  );
  if (outcome === "done") {
    await notifyDecision(db, dataKey, applicationPublicId, "rejected", parsed.data.reason);
    return { ok: true };
  }
  return await classifyDecideFailure(db, actor, applicationPublicId);
}

async function classifyDecideFailure(db: D1Database, actor: string, applicationPublicId: string): Promise<DecideResult> {
  const check = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM applications WHERE public_id = ?1) AS app_exists,
         ${coordinatorForSection(2, applicationSection(1))} AS allowed
       `,
    )
    .bind(applicationPublicId, actor)
    .first<{ app_exists: number; allowed: number }>();
  if (!check?.app_exists) return { ok: false, reason: "not_found" };
  if (check.allowed !== 1) return { ok: false, reason: "not_allowed" };
  return { ok: false, reason: "already_resolved" };
}

/** Never pass the temporary password here: it must reach the outbox and its queue table for no one but the Co-ordinator who
 * approved it to see, so it goes back in the API response instead (`ApproveResult`), the same way staff accounts do (D-059). */
async function notifyDecision(db: D1Database, dataKey: string, applicationPublicId: string, decision: "needs_changes" | "rejected" | "approved", reason: string, sid?: string): Promise<void> {
  const app = await db.prepare("SELECT email FROM applications WHERE public_id = ?1").bind(applicationPublicId).first<{ email: string }>();
  if (!app) return;
  await db.batch([
    await queueEmail(db, dataKey, {
      template: "admission_decision",
      to: app.email,
      data: { decision, reason, ...(sid ? { sid } : {}) },
      dedupeKey: `admission-decision:${applicationPublicId}:${decision}`,
    }),
  ]);
}

const CLASS_NOT_OPEN = "That class is not open, or is not of the application's level.";
const EMAIL_TAKEN = "That email already signs someone in. Each student needs their own email.";
const EMAIL_TAKEN_APPROVE = `${EMAIL_TAKEN} Ask for changes so the applicant can give another.`;

/** `temporaryPassword` is returned here and nowhere else (never emailed, never logged, D-059's own rule for a secret like this): shown once to the Co-ordinator who approved it, who must relay it to the new student some other way. */
export type ApproveResult = { ok: true; sid: string; studentId: string; temporaryPassword: string } | WriteFailure | { ok: false; reason: "already_resolved" } | { ok: false; reason: "invalid"; message: string };

/**
 * Approve-and-apply is one batch (D-063, the same shape D-061's approvals engine uses): the FIRST
 * statement (the SID counter) carries the whole guard — the application is still pending, the class
 * is of the application's own level and is active, and the actor is a Co-ordinator for that section —
 * and every statement after it is chained by `changes()`, so nothing half-happens.
 */
export async function approveApplication(
  db: D1Database,
  auditKey: string,
  dataKey: string,
  actor: string,
  applicationPublicId: string,
  input: ApproveInput,
  now: Date = new Date(),
): Promise<ApproveResult> {
  const studentPublicId = newPublicId();
  const userPublicId = newPublicId();
  const temporaryPassword = generateTemporaryPassword();
  const at = now.toISOString();

  const classGuard = `EXISTS (SELECT 1 FROM classes cl JOIN applications ap2 ON ap2.public_id = ?2
                               WHERE cl.public_id = ?3 AND cl.level_id = ap2.level_id AND cl.is_active = 1)`;
  const appGuard = `EXISTS (SELECT 1 FROM applications WHERE public_id = ?2 AND status = 'pending_review')`;

  const outcome = await write(
    db,
    auditKey,
    { action: "admissions.approved", entityType: "student", entityPublicId: studentPublicId, actorPublicId: actor, summary: "Application approved; student admitted", after: { classId: input.classId } },
    [
      db
        .prepare(`UPDATE sid_counter SET next_sequence = next_sequence + 1 WHERE id = 1 AND ${appGuard} AND ${classGuard} AND ${coordinatorForSection(1, applicationSection(2))}`)
        .bind(actor, applicationPublicId, input.classId),
      db
        .prepare(
          `INSERT INTO students (public_id, sid, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name, guardian_phone, previous_school, referred_by, admission_bs_year, created_at)
           SELECT ?1, printf('%d-%05d', ay.bs_year, (SELECT next_sequence - 1 FROM sid_counter WHERE id = 1)),
                  ap.first_name, ap.middle_name, ap.last_name, ap.dob_ad, ap.phone, ap.email, ap.guardian_name, ap.guardian_phone, ap.previous_school, ap.referred_by, ay.bs_year, ?3
             FROM applications ap JOIN academic_years ay ON ay.id = ap.academic_year_id
            WHERE ap.public_id = ?2 AND changes() > 0`,
        )
        .bind(studentPublicId, applicationPublicId, at),
      db
        .prepare(
          `INSERT INTO users (public_id, email, password_hash, full_name, phone, must_change_password)
           SELECT ?1, st.email, ?3, st.first_name || ' ' || st.last_name, st.phone, 1
             FROM students st WHERE st.public_id = ?2 AND changes() > 0`,
        )
        .bind(userPublicId, studentPublicId, hashPassword(temporaryPassword)),
      db.prepare(`INSERT INTO role_assignments (user_id, role, scope_type, section_id) SELECT u.id, 'student', 'own', NULL FROM users u WHERE u.public_id = ?1 AND changes() > 0`).bind(userPublicId),
      db.prepare(`UPDATE students SET user_id = (SELECT id FROM users WHERE public_id = ?1) WHERE public_id = ?2 AND changes() > 0`).bind(userPublicId, studentPublicId),
      db
        .prepare(
          `INSERT INTO enrollments (public_id, student_id, academic_year_id, class_id, roll_no, status, created_at)
           SELECT ?1, (SELECT id FROM students WHERE public_id = ?2), ap.academic_year_id, (SELECT id FROM classes WHERE public_id = ?3), ?4, 'active', ?5
             FROM applications ap WHERE ap.public_id = ?6 AND changes() > 0`,
        )
        .bind(newPublicId(), studentPublicId, input.classId, input.rollNo ?? null, at, applicationPublicId),
      db
        .prepare(
          `UPDATE applications SET status = 'approved', reviewed_by = (SELECT id FROM users WHERE public_id = ?2), decided_at = ?3, updated_at = ?3, student_id = (SELECT id FROM students WHERE public_id = ?4)
            WHERE public_id = ?1 AND changes() > 0`,
        )
        .bind(applicationPublicId, actor, at, studentPublicId),
    ],
  );

  if (outcome === "done") {
    const created = await db.prepare("SELECT sid FROM students WHERE public_id = ?1").bind(studentPublicId).first<{ sid: string }>();
    await notifyDecision(db, dataKey, applicationPublicId, "approved", "", created!.sid);
    return { ok: true, sid: created!.sid, studentId: studentPublicId, temporaryPassword };
  }
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: CLASS_NOT_OPEN };
  if (outcome === "duplicate") {
    // The new login's email is already someone's sign-in (each login has its own email): say so, rather than "not allowed".
    const taken = await db.prepare("SELECT EXISTS (SELECT 1 FROM users WHERE email = (SELECT lower(email) FROM applications WHERE public_id = ?1)) AS taken").bind(applicationPublicId).first<{ taken: number }>();
    if (taken?.taken === 1) return { ok: false, reason: "invalid", message: EMAIL_TAKEN_APPROVE };
  }
  return await classifyApproveFailure(db, actor, applicationPublicId, input.classId);
}

async function classifyApproveFailure(db: D1Database, actor: string, applicationPublicId: string, classId: string): Promise<ApproveResult> {
  const check = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM applications WHERE public_id = ?1) AS app_exists,
         EXISTS (SELECT 1 FROM applications WHERE public_id = ?1 AND status = 'pending_review') AS app_pending,
         EXISTS (SELECT 1 FROM classes cl JOIN applications ap ON ap.public_id = ?1 WHERE cl.public_id = ?3 AND cl.level_id = ap.level_id AND cl.is_active = 1) AS class_ok,
         ${coordinatorForSection(2, applicationSection(1))} AS allowed
       `,
    )
    .bind(applicationPublicId, actor, classId)
    .first<{ app_exists: number; app_pending: number; class_ok: number; allowed: number }>();
  if (!check?.app_exists) return { ok: false, reason: "not_found" };
  if (check.allowed !== 1) return { ok: false, reason: "not_allowed" };
  if (!check.app_pending) return { ok: false, reason: "already_resolved" };
  if (!check.class_ok) return { ok: false, reason: "invalid", message: "Pick a class of the application's own level, that is still active." };
  return { ok: false, reason: "not_allowed" };
}


// --- Correcting a student's personal details (Co-ordinator FUT F-06) ------------------------------------------

const STUDENT_COLUMNS: Record<Exclude<keyof CorrectStudent, "reason">, string> = {
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  dob: "dob_ad",
  phone: "phone",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  previousSchool: "previous_school",
};

/** The section of the class a student is in this year; none when not enrolled (then only a whole-school Co-ordinator reaches them). */
const studentSection = (n: number): string =>
  `(SELECT pv.section_id FROM students st JOIN enrollments en ON en.student_id = st.id
      JOIN academic_years ay ON ay.id = en.academic_year_id AND ay.status = 'active'
      JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
     WHERE st.public_id = ?${n})`;

export type CorrectResult = { ok: true } | WriteFailure | Invalid;

/**
 * One student's personal details corrected, with the reason, in one batch with its audit entry. The Co-ordinator is
 * re-checked inside the write for the student's section (D-021); the SID and the yearly enrollment never change here.
 */
export async function correctStudent(db: D1Database, auditKey: string, actor: string, studentPublicId: string, input: CorrectStudent): Promise<CorrectResult> {
  const parsed = CorrectStudentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const { reason, ...changes } = parsed.data;
  const fields = (Object.keys(changes) as (keyof typeof STUDENT_COLUMNS)[]).filter((k) => changes[k] !== undefined);
  const before = await db
    .prepare(`SELECT first_name, middle_name, last_name, dob_ad, phone, guardian_name, guardian_phone, previous_school FROM students WHERE public_id = ?1`)
    .bind(studentPublicId)
    .first<Record<string, string | null>>();
  if (!before) return { ok: false, reason: "not_found" };
  // Only fixed column names from the map above are written into the SQL; every value is bound.
  const sets = fields.map((k, i) => `${STUDENT_COLUMNS[k]} = ?${i + 3}`).join(", ");
  const values = fields.map((k) => {
    const v = changes[k];
    return typeof v === "string" && v.trim() === "" ? null : (v ?? null);
  });
  const outcome = await write(
    db,
    auditKey,
    {
      action: "students.personal.corrected",
      entityType: "student",
      entityPublicId: studentPublicId,
      actorPublicId: actor,
      summary: `Personal details corrected: ${fields.join(", ")}`,
      reason,
      before: Object.fromEntries(fields.map((k) => [k, before[STUDENT_COLUMNS[k]] ?? null])),
      after: Object.fromEntries(fields.map((k, i) => [k, values[i] ?? null])),
    },
    [
      db
        .prepare(
          `UPDATE students SET ${sets}
            WHERE public_id = ?1 AND ${coordinatorForSection(2, `COALESCE(${studentSection(1)}, -1)`)}`,
        )
        .bind(studentPublicId, actor, ...values),
    ],
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "check_failed") return { ok: false, reason: "invalid", message: "That detail is not valid." };
  return { ok: false, reason: "not_allowed" };
}
