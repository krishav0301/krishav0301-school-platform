import { z } from "@hono/zod-openapi";

import { recordAudit } from "../../core/audit";

/**
 * A person's own account (Settings, D-091). Anyone signed in sees their own name, email and phone. Staff may correct
 * their own name and phone; a student may not, because a student's personal details are corrected only by the
 * Co-ordinator, with a reason (CLAUDE.md section 6). The email is the sign-in and is not changed here.
 */
export const ProfileSchema = z.object({ fullName: z.string(), email: z.string(), phone: z.string().nullable(), canEditProfile: z.boolean() }).openapi("OwnProfile");
export const ProfileUpdateSchema = z
  .strictObject({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(5).max(30).nullable() })
  .openapi("OwnProfileUpdate");
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/** An active person with an active staff role: who may correct their own details. `?n` is their public id. */
const IS_STAFF = (n: number) =>
  `EXISTS (SELECT 1 FROM users su JOIN role_assignments sr ON sr.user_id = su.id
            WHERE su.public_id = ?${n} AND su.is_active = 1 AND sr.is_active = 1 AND sr.role IN ('teacher', 'coordinator', 'accountant', 'admin', 'super_admin'))`;

export async function getOwnProfile(db: D1Database, userPublicId: string): Promise<z.infer<typeof ProfileSchema> | null> {
  const row = await db
    .prepare(`SELECT full_name, email, phone, ${IS_STAFF(1)} AS staff FROM users WHERE public_id = ?1 AND is_active = 1`)
    .bind(userPublicId)
    .first<{ full_name: string; email: string; phone: string | null; staff: number }>();
  return row ? { fullName: row.full_name, email: row.email, phone: row.phone, canEditProfile: row.staff === 1 } : null;
}

/** Corrects the person's own name and phone, re-checking inside the write that they are active staff. */
export async function updateOwnProfile(db: D1Database, auditKey: string, userPublicId: string, input: ProfileUpdate): Promise<{ ok: true } | { ok: false; reason: "not_allowed" }> {
  const before = await getOwnProfile(db, userPublicId);
  if (!before?.canEditProfile) return { ok: false, reason: "not_allowed" };
  if (before.fullName === input.fullName && before.phone === input.phone) return { ok: true };
  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "accounts.profile.updated",
      entityType: "user",
      entityPublicId: userPublicId,
      actorPublicId: userPublicId,
      summary: "Corrected their own name or phone",
      before: { fullName: before.fullName, phone: before.phone },
      after: input,
    },
    [db.prepare(`UPDATE users SET full_name = ?2, phone = ?3 WHERE public_id = ?1 AND ${IS_STAFF(1)}`).bind(userPublicId, input.fullName, input.phone)],
    { onlyIfLastChanged: true },
  );
  return applied ? { ok: true } : { ok: false, reason: "not_allowed" };
}
