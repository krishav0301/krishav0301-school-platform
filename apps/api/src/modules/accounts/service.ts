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
