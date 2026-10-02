/**
 * Staff accounts (D-059): who creates whom, the one-time temporary password, switching people off and on, and the list.
 *
 * Every write is one audited batch and re-checks the ACTOR inside its own SQL (`guard.ts`), so a switched-off or
 * demoted person with a still-valid sign-in changes nothing. Nobody changes their own account here. The temporary
 * password is a secret: it is returned once to the caller, only its hash is stored, and it is never in an audit entry
 * or any other record.
 */
import { newPublicId } from "../../core/ids";
import { hashPassword } from "../../core/passwords";
import { generateTemporaryPassword } from "../../core/temporary-password";
import type { RoleClaim } from "../../core/tokens";
import { actorMayCreateStaff, actorMayCreateTeacher, actorMayManage } from "./guard";
import { CreateStaffSchema, CreateTeacherSchema, type StaffInput, type StaffList, type TeacherInput } from "./staff-schema";
import { write } from "./write";

export type StaffFailure = { ok: false; reason: "not_allowed" | "not_found" | "conflict" } | { ok: false; reason: "invalid"; message: string };
export type StaffCreated = ({ ok: true; publicId: string; temporaryPassword: string }) | StaffFailure;
export type StaffDone = { ok: true } | { ok: false; reason: "not_allowed" | "not_found" };
export type StaffPassword = { ok: true; temporaryPassword: string } | { ok: false; reason: "not_allowed" | "not_found" };

const firstMessage = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? "That is not valid";

/** Adds a Co-ordinator or an Accountant, whole-school or limited to some switched-on sections. Returns the temporary password, once. */
export async function createStaff(db: D1Database, auditKey: string, actor: string, input: StaffInput): Promise<StaffCreated> {
  const parsed = CreateStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;
  const sectionKeys = p.sectionKeys ?? (p.sectionKey ? [p.sectionKey] : []);
  const scope = sectionKeys.length > 0 ? "section" : "institution";
  const keysJson = JSON.stringify(sectionKeys);

  const publicId = newPublicId();
  const temporaryPassword = generateTemporaryPassword();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "accounts.staff.created",
      entityType: "user",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `${p.role === "coordinator" ? "Co-ordinator" : "Accountant"} account created for ${p.fullName}`,
      after: { email: p.email, role: p.role, scope, sections: sectionKeys },
    },
    [
      db
        .prepare(
          `INSERT INTO users (public_id, email, password_hash, full_name, phone, must_change_password)
           SELECT ?1, ?2, ?3, ?4, ?5, 1
            WHERE ${actorMayCreateStaff(6)} AND ${allSwitchedOnSections(7)}`,
        )
        .bind(publicId, p.email, hashPassword(temporaryPassword), p.fullName, p.phone ?? null, actor, keysJson),
      // Last: it changes a row only if the person was made, which is what decides whether the audit entry is written.
      // One row for the whole school, or one per section (D-099).
      db
        .prepare(
          `INSERT INTO role_assignments (user_id, role, scope_type, section_id)
           SELECT u.id, ?2, 'institution', NULL FROM users u WHERE u.public_id = ?1 AND json_array_length(?3) = 0
           UNION ALL
           SELECT u.id, ?2, 'section', s.id FROM users u JOIN sections s ON s.key IN (SELECT value FROM json_each(?3)) WHERE u.public_id = ?1`,
        )
        .bind(publicId, p.role, keysJson),
    ],
  );

  if (outcome === "done") return { ok: true, publicId, temporaryPassword };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "check_failed") return { ok: false, reason: "not_found" };

  const check = await db
    .prepare(`SELECT ${actorMayCreateStaff(1)} AS allowed, ${allSwitchedOnSections(2)} AS section_ok`)
    .bind(actor, keysJson)
    .first<{ allowed: number; section_ok: number }>();
  if (check?.allowed !== 1) return { ok: false, reason: "not_allowed" };
  return { ok: false, reason: check.section_ok === 1 ? "not_allowed" : "not_found" };
}

/** Adds a teacher with a home section. A section-scoped Co-ordinator can only choose their own. Returns the temporary password, once. */
export async function createTeacher(db: D1Database, auditKey: string, actor: string, input: TeacherInput): Promise<StaffCreated> {
  const parsed = CreateTeacherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;

  const publicId = newPublicId();
  const temporaryPassword = generateTemporaryPassword();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "accounts.staff.created",
      entityType: "user",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Teacher account created for ${p.fullName}`,
      after: { email: p.email, role: "teacher", homeSection: p.homeSectionKey },
    },
    [
      db
        .prepare(
          `INSERT INTO users (public_id, email, password_hash, full_name, phone, must_change_password)
           SELECT ?1, ?2, ?3, ?4, ?5, 1
            WHERE ${actorMayCreateTeacher(6, 7)} AND EXISTS (SELECT 1 FROM sections WHERE key = ?7)`,
        )
        .bind(publicId, p.email, hashPassword(temporaryPassword), p.fullName, p.phone ?? null, actor, p.homeSectionKey),
      db
        .prepare(`INSERT INTO staff_profiles (user_id, home_section_id) SELECT u.id, (SELECT id FROM sections WHERE key = ?2) FROM users u WHERE u.public_id = ?1`)
        .bind(publicId, p.homeSectionKey),
      db
        .prepare(`INSERT INTO role_assignments (user_id, role, scope_type, section_id) SELECT u.id, 'teacher', 'assigned', NULL FROM users u WHERE u.public_id = ?1`)
        .bind(publicId),
    ],
  );

  if (outcome === "done") return { ok: true, publicId, temporaryPassword };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  if (outcome === "check_failed") return { ok: false, reason: "not_found" };

  const check = await db
    .prepare(`SELECT ${actorMayCreateTeacher(1, 2)} AS allowed, EXISTS (SELECT 1 FROM sections WHERE key = ?2) AS section_ok`)
    .bind(actor, p.homeSectionKey)
    .first<{ allowed: number; section_ok: number }>();
  if (check?.section_ok !== 1 && check?.allowed === 1) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "not_allowed" };
}

/** True when every key in the JSON array `?k` is a switched-on section (D-097: a switched-off section takes nothing new). */
const allSwitchedOnSections = (k: number) =>
  `NOT EXISTS (SELECT 1 FROM json_each(?${k}) jk WHERE NOT EXISTS (SELECT 1 FROM sections sk WHERE sk.key = jk.value AND sk.is_active = 1))`;

/**
 * May the actor change where this person's access reaches (D-099)? An active Admin or Super Admin, never for
 * themselves, and only for a Co-ordinator or an Accountant (who is not also an Admin). Unlike `actorMayManage`, this
 * does not ask whether the target's role is switched on now, because the change itself switches rows off and on.
 */
const actorMayChangeAccess = (a: number, t: number) =>
  `(${actorMayCreateStaff(a)} AND ?${a} <> ?${t}
    AND EXISTS (SELECT 1 FROM users cu JOIN role_assignments cr ON cr.user_id = cu.id
                 WHERE cu.public_id = ?${t} AND cr.role IN ('coordinator', 'accountant'))
    AND NOT EXISTS (SELECT 1 FROM users xu JOIN role_assignments xr ON xr.user_id = xu.id
                     WHERE xu.public_id = ?${t} AND xr.role IN ('admin', 'super_admin', 'teacher', 'student') AND xr.is_active = 1))`;

export type AccessResult = { ok: true } | { ok: false; reason: "not_allowed" | "not_found" } | { ok: false; reason: "invalid"; message: string };

/**
 * Changes where a Co-ordinator's or Accountant's access reaches (D-099): the whole school (`[]`) or these sections.
 * One audited batch: missing rows are added switched off, then one statement switches on exactly the rows of the new
 * scope and off every other row of that role, under the guard, so nothing is half-changed and nothing is deleted. It
 * takes effect at the person's next sign-in renewal, within 30 minutes (D-021); money, approval and publish actions
 * re-check assignments inside their own batch, so a narrowed scope holds there at once.
 */
export async function setStaffAccess(db: D1Database, auditKey: string, actor: string, target: string, sectionKeys: string[]): Promise<AccessResult> {
  const keysJson = JSON.stringify([...new Set(sectionKeys)].sort());
  const [state] = await db.batch([
    db
      .prepare(
        `SELECT u.full_name, ${actorMayChangeAccess(1, 2)} AS allowed, ${allSwitchedOnSections(3)} AS sections_ok,
                (SELECT ra.role FROM role_assignments ra WHERE ra.user_id = u.id AND ra.role IN ('coordinator', 'accountant') ORDER BY ra.is_active DESC, ra.id LIMIT 1) AS role,
                (SELECT json_group_array(k) FROM (SELECT s.key AS k FROM role_assignments rs JOIN sections s ON s.id = rs.section_id
                  WHERE rs.user_id = u.id AND rs.is_active = 1 AND rs.role IN ('coordinator', 'accountant') ORDER BY s.key)) AS sections_now,
                EXISTS (SELECT 1 FROM role_assignments ri WHERE ri.user_id = u.id AND ri.is_active = 1 AND ri.scope_type = 'institution' AND ri.role IN ('coordinator', 'accountant')) AS whole_now
           FROM users u WHERE u.public_id = ?2`,
      )
      .bind(actor, target, keysJson),
  ]);
  const row = state!.results[0] as { full_name: string; allowed: number; sections_ok: number; role: "coordinator" | "accountant" | null; sections_now: string; whole_now: number } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.allowed !== 1 || !row.role) return { ok: false, reason: "not_allowed" };
  if (row.sections_ok !== 1) return { ok: false, reason: "invalid", message: "Choose sections that exist and are switched on" };

  const before = row.whole_now === 1 ? [] : (JSON.parse(row.sections_now) as string[]);
  const after = JSON.parse(keysJson) as string[];
  if (JSON.stringify(before) === keysJson && (row.whole_now === 1) === (after.length === 0)) return { ok: true }; // no change, nothing recorded

  const outcome = await write(
    db,
    auditKey,
    {
      action: "accounts.access.changed",
      entityType: "user",
      entityPublicId: target,
      actorPublicId: actor,
      summary: `${row.full_name}'s access changed to ${after.length === 0 ? "the whole school" : `${after.length} section${after.length === 1 ? "" : "s"}`}`,
      before: { role: row.role, sections: before.length === 0 ? "whole school" : before },
      after: { role: row.role, sections: after.length === 0 ? "whole school" : after },
    },
    [
      // The rows the new scope needs and does not have yet, switched off for now.
      db
        .prepare(
          `INSERT INTO role_assignments (user_id, role, scope_type, section_id, is_active)
           SELECT u.id, ?3, 'institution', NULL, 0 FROM users u
            WHERE u.public_id = ?2 AND json_array_length(?4) = 0 AND ${actorMayChangeAccess(1, 2)}
              AND NOT EXISTS (SELECT 1 FROM role_assignments e WHERE e.user_id = u.id AND e.role = ?3 AND e.scope_type = 'institution')
           UNION ALL
           SELECT u.id, ?3, 'section', s.id, 0 FROM users u JOIN sections s ON s.key IN (SELECT value FROM json_each(?4))
            WHERE u.public_id = ?2 AND ${actorMayChangeAccess(1, 2)}
              AND NOT EXISTS (SELECT 1 FROM role_assignments e WHERE e.user_id = u.id AND e.role = ?3 AND e.section_id = s.id)`,
        )
        .bind(actor, target, row.role, keysJson),
      // Last, and it always changes rows when allowed: exactly the new scope's rows on, every other row of the role off.
      db
        .prepare(
          `UPDATE role_assignments
              SET is_active = CASE
                    WHEN json_array_length(?4) = 0 THEN (scope_type = 'institution')
                    ELSE (scope_type = 'section' AND section_id IN (SELECT id FROM sections WHERE key IN (SELECT value FROM json_each(?4))))
                  END
            WHERE user_id = (SELECT id FROM users WHERE public_id = ?2) AND role = ?3 AND ${actorMayChangeAccess(1, 2)}`,
        )
        .bind(actor, target, row.role, keysJson),
    ],
  );
  return outcome === "done" ? { ok: true } : { ok: false, reason: "not_allowed" };
}

interface Look {
  full_name: string;
  is_active: number;
  allowed: number;
}

/** One round trip: does the person exist, are they switched on, and may the actor manage them? Null if they do not exist. */
async function look(db: D1Database, actor: string, target: string): Promise<Look | null> {
  return db
    .prepare(`SELECT u.full_name, u.is_active, ${actorMayManage(1, 2)} AS allowed FROM users u WHERE u.public_id = ?2`)
    .bind(actor, target)
    .first<Look>();
}

/** Switches a person off or on. Switching off also ends their open sessions, in the same batch. */
export async function setStaffActive(db: D1Database, auditKey: string, actor: string, target: string, active: boolean, now: Date = new Date()): Promise<StaffDone> {
  const before = await look(db, actor, target);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.allowed !== 1) return { ok: false, reason: "not_allowed" };
  if ((before.is_active === 1) === active) return { ok: true }; // already so: nothing to change, nothing to record

  const statements = [
    // Under the same guard as the change, so a person who may not switch this one off cannot end their sessions either.
    ...(active
      ? []
      : [
          db
            .prepare(
              `UPDATE sessions SET revoked_at = ?1, revoked_reason = 'deactivated'
                WHERE user_id = (SELECT id FROM users WHERE public_id = ?2) AND revoked_at IS NULL AND ${actorMayManage(3, 2)}`,
            )
            .bind(now.toISOString(), target, actor),
        ]),
    db.prepare(`UPDATE users SET is_active = ?1 WHERE public_id = ?2 AND is_active <> ?1 AND ${actorMayManage(3, 2)}`).bind(active ? 1 : 0, target, actor),
  ];

  const outcome = await write(
    db,
    auditKey,
    {
      action: "accounts.staff.updated",
      entityType: "user",
      entityPublicId: target,
      actorPublicId: actor,
      summary: `${before.full_name} switched ${active ? "on" : "off"}`,
      before: { active: !active },
      after: { active },
    },
    statements,
  );
  if (outcome === "done") return { ok: true };

  const again = await look(db, actor, target); // a lost race, or the actor was switched off a moment ago
  if (again && again.allowed === 1 && (again.is_active === 1) === active) return { ok: true };
  return { ok: false, reason: again ? "not_allowed" : "not_found" };
}

/**
 * Gives a person a new temporary password, for a forgotten one (email is a development adapter until Phase 9, so
 * nobody would otherwise get back in). They must change it at once; their open sessions end and a lockout is cleared.
 * Returned once.
 */
export async function issueTemporaryPassword(db: D1Database, auditKey: string, actor: string, target: string, now: Date = new Date()): Promise<StaffPassword> {
  const before = await look(db, actor, target);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.allowed !== 1) return { ok: false, reason: "not_allowed" };

  const temporaryPassword = generateTemporaryPassword();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "accounts.password.issued",
      entityType: "user",
      entityPublicId: target,
      actorPublicId: actor,
      summary: `A new temporary password was issued to ${before.full_name}`,
    },
    [
      db
        .prepare(
          `UPDATE sessions SET revoked_at = ?1, revoked_reason = 'password_issued'
            WHERE user_id = (SELECT id FROM users WHERE public_id = ?2) AND revoked_at IS NULL AND ${actorMayManage(3, 2)}`,
        )
        .bind(now.toISOString(), target, actor),
      db
        .prepare(
          `UPDATE users SET password_hash = ?1, must_change_password = 1, failed_login_count = 0, locked_until = NULL
            WHERE public_id = ?2 AND ${actorMayManage(3, 2)}`,
        )
        .bind(hashPassword(temporaryPassword), target, actor),
    ],
  );
  return outcome === "done" ? { ok: true, temporaryPassword } : { ok: false, reason: "not_allowed" };
}

interface StaffRow {
  public_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
  role: string;
  scope_type: RoleClaim["scope"];
  role_section: string | null;
  home_section: string | null;
}

/**
 * The staff a person may see, by their roles: a Super Admin sees Admins, Co-ordinators, Accountants and teachers; an Admin
 * sees Co-ordinators, Accountants and teachers; a Co-ordinator sees only teachers, and only their own section's if their
 * scope is one section. Nobody sees a Super Admin, and no other role sees anyone. Carries no password or hash.
 */
export async function listStaff(db: D1Database, viewer: readonly RoleClaim[]): Promise<StaffList> {
  const has = (role: string) => viewer.some((r) => r.role === role);
  let targets: string[] = [];
  let sections: string[] | null = null;
  if (has("super_admin")) targets = ["admin", "coordinator", "accountant", "teacher"];
  else if (has("admin")) targets = ["coordinator", "accountant", "teacher"];
  else if (has("coordinator")) {
    targets = ["teacher"];
    const wholeSchool = viewer.some((r) => r.role === "coordinator" && r.scope === "institution");
    sections = wholeSchool ? null : viewer.filter((r) => r.role === "coordinator" && r.scope === "section" && r.section).map((r) => r.section!);
  }
  if (targets.length === 0) return { staff: [] };

  const { results } = await db
    .prepare(
      `SELECT u.public_id, u.full_name, u.email, u.phone, u.is_active, u.must_change_password, u.last_login_at,
              ra.role, ra.scope_type, rs.key AS role_section, hs.key AS home_section
         FROM users u
         JOIN role_assignments ra ON ra.user_id = u.id AND ra.is_active = 1
         LEFT JOIN sections rs ON rs.id = ra.section_id
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         LEFT JOIN sections hs ON hs.id = sp.home_section_id
        WHERE ra.role IN (SELECT value FROM json_each(?1))
          AND (?2 IS NULL OR hs.key IN (SELECT value FROM json_each(?2)))
          AND NOT EXISTS (SELECT 1 FROM role_assignments x WHERE x.user_id = u.id AND x.role = 'super_admin' AND x.is_active = 1)
        ORDER BY u.full_name COLLATE NOCASE, u.id, ra.id`,
    )
    .bind(JSON.stringify(targets), sections === null ? null : JSON.stringify(sections))
    .all<StaffRow>();

  const staff: StaffList["staff"] = [];
  for (const r of results) {
    let member = staff[staff.length - 1];
    if (!member || member.id !== r.public_id) {
      member = {
        id: r.public_id,
        fullName: r.full_name,
        email: r.email,
        phone: r.phone,
        roles: [],
        homeSection: r.home_section,
        active: r.is_active === 1,
        mustChangePassword: r.must_change_password === 1,
        lastSignInAt: r.last_login_at,
      };
      staff.push(member);
    }
    member.roles.push({ role: r.role, scope: r.scope_type, section: r.role_section });
  }
  return { staff };
}
