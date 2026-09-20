import { recordAudit } from "../../core/audit";
import { checkContrast, type ContrastFailure, type Theme } from "../../core/theme";

export type SaveThemeResult = { ok: true } | { ok: false; failures: ContrastFailure[] };

/**
 * Saves a new active theme, but only if every colour pair is readable. The old theme is kept (no
 * deletes). The change and its audit entry are one batch.
 */
export async function saveTheme(
  db: D1Database,
  auditKey: string,
  theme: Theme,
  actorPublicId: string,
): Promise<SaveThemeResult> {
  const failures = checkContrast(theme);
  if (failures.length > 0) return { ok: false, failures };

  await recordAudit(
    db,
    auditKey,
    {
      action: "config.theme.changed",
      entityType: "theme",
      actorPublicId,
      summary: `Theme changed to "${theme.name}"`,
      after: theme,
    },
    [
      db.prepare("UPDATE themes SET is_active = 0 WHERE is_active = 1"),
      db.prepare("INSERT INTO themes (name, tokens_json, is_active) VALUES (?1, ?2, 1)").bind(theme.name, JSON.stringify(theme)),
    ],
  );
  return { ok: true };
}
