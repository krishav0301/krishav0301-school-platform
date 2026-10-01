import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { hashPassword, passwordProblems, type PasswordProblem } from "../../core/passwords";

import type { Role, Scope } from "../../core/roles";

export type { Role, Scope };

export interface RoleInput {
  role: Role;
  scope: Scope;
  /** Required for section scope. */
  sectionKey?: string;
}

export interface NewUser {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  roles: RoleInput[];
  /** Who is creating this account, for the audit trail. */
  actorUserId?: number;
  /** Words the password must not contain, such as the school's name (see `schoolNameWords`). */
  avoidWords?: readonly string[];
}

export class WeakPasswordError extends Error {
  constructor(readonly problems: PasswordProblem[]) {
    super(`Password is not acceptable: ${problems.join(", ")}`);
    this.name = "WeakPasswordError";
  }
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

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

/**
 * Creates a user and their role assignments in one batch, with the audit entry that records it.
 * The database refuses impossible role and scope pairs, unknown sections, and duplicate emails,
 * and then neither the user nor the audit entry is saved.
 */
export async function createUser(db: D1Database, auditKey: string, input: NewUser): Promise<{ publicId: string }> {
  const email = normaliseEmail(input.email);
  const problems = passwordProblems(input.password, email, input.avoidWords);
  if (problems.length > 0) throw new WeakPasswordError(problems);

  const publicId = newPublicId();
  const passwordHash = hashPassword(input.password);

  const statements = [
    db
      .prepare("INSERT INTO users (public_id, email, password_hash, full_name, phone) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(publicId, email, passwordHash, input.fullName.trim(), input.phone ?? null),
    ...input.roles.map((r) =>
      db
        .prepare(
          `INSERT INTO role_assignments (user_id, role, scope_type, section_id)
           SELECT u.id, ?2, ?3, (SELECT id FROM sections WHERE key = ?4) FROM users u WHERE u.public_id = ?1`,
        )
        .bind(publicId, r.role, r.scope, r.sectionKey ?? null),
    ),
  ];

  await recordAudit(
    db,
    auditKey,
    {
      action: "accounts.user.created",
      entityType: "user",
      entityPublicId: publicId,
      actorUserId: input.actorUserId ?? null,
      summary: `Account created for ${input.fullName.trim()}`,
      after: { email, roles: input.roles },
    },
    statements,
  );

  return { publicId };
}

export type ResetTwoFactorResult = "done" | "not_found" | "own_account";

/**
 * Removes a person's two-step sign-in (lost phone and no recovery codes) and ends their sessions,
 * so the next sign-in has to set it up again. Nobody resets their own: a stolen session could
 * otherwise switch the protection off. Recorded in the audit log, naming who did it.
 */
export async function resetTwoFactor(
  db: D1Database,
  auditKey: string,
  input: { targetPublicId: string; actorPublicId: string },
  now: Date = new Date(),
): Promise<ResetTwoFactorResult> {
  if (input.targetPublicId === input.actorPublicId) return "own_account";
  const target = await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(input.targetPublicId).first<{ id: number }>();
  if (!target) return "not_found";

  await recordAudit(
    db,
    auditKey,
    {
      action: "accounts.two_factor.reset",
      entityType: "user",
      entityPublicId: input.targetPublicId,
      actorPublicId: input.actorPublicId,
      summary: "Two-step sign-in removed; the person must set it up again",
    },
    [
      db.prepare("DELETE FROM two_factor_recovery_codes WHERE user_id = ?1").bind(target.id),
      db.prepare("DELETE FROM user_two_factor WHERE user_id = ?1").bind(target.id),
      db.prepare("UPDATE sessions SET revoked_at = ?1, revoked_reason = 'two_factor_reset' WHERE user_id = ?2 AND revoked_at IS NULL").bind(now.toISOString(), target.id),
    ],
  );
  return "done";
}

export * from "./staff";

/**
 * The dashboard's "Faculty & Staff" figure (D-088): active people with an active Teacher, Co-ordinator or Accountant
 * role, now and at `since`. The Admin and Support are not counted.
 */
export function staffDashboardPart(db: D1Database, since: string): DashboardPart<{ total: number; previous: number }> {
  return {
    statements: [
      db
        .prepare(
          `SELECT COUNT(DISTINCT u.id) AS total, COUNT(DISTINCT CASE WHEN u.created_at < ?1 THEN u.id END) AS previous
             FROM users u JOIN role_assignments ra ON ra.user_id = u.id
            WHERE u.is_active = 1 AND ra.is_active = 1 AND ra.role IN ('teacher', 'coordinator', 'accountant')`,
        )
        .bind(since),
    ],
    read: ([r]) => rowsOf<{ total: number; previous: number }>(r)[0] ?? { total: 0, previous: 0 },
  };
}
