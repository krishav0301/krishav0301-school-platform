/**
 * Which parts of the product exist, and which a school may switch off (D-008).
 * Mandatory modules carry the rules that must always hold (ledger, approvals, audit, results),
 * so no configuration can remove them. Optional ones are features a school may not want.
 */
export const MANDATORY_MODULES = [
  "accounts", "admissions", "academics", "approvals", "audit",
  "content", "files", "notifications", "results",
] as const;

// Fees became switchable on 2026-10-11 (D-137): a school that only runs results has no Fees and no Accountant.
// The daily activity log became switchable on 2026-10-11 (D-139): a school that only runs results has no daily log.
export const OPTIONAL_MODULES = ["attendance", "teacher_attendance", "homework", "notes", "top20", "fees", "activity_log"] as const;

export const ALL_MODULES: readonly string[] = [...MANDATORY_MODULES, ...OPTIONAL_MODULES];

export const isKnownModule = (key: string): boolean => ALL_MODULES.includes(key);
export const isMandatoryModule = (key: string): boolean => (MANDATORY_MODULES as readonly string[]).includes(key);

/** Every module with its final on/off state. Mandatory modules are always on; unlisted ones default on. */
export function resolveModules(switches: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(ALL_MODULES.map((key) => [key, isMandatoryModule(key) ? true : (switches[key] ?? true)]));
}
