/**
 * Which parts of the product exist, and which a school may switch off (D-008).
 * Mandatory modules carry the rules that must always hold (ledger, approvals, audit, results),
 * so no configuration can remove them. Optional ones are features a school may not want.
 */
export const MANDATORY_MODULES = [
  "accounts", "admissions", "academics", "approvals", "audit",
  "content", "fees", "files", "notifications", "results",
] as const;

export const OPTIONAL_MODULES = ["attendance", "teacher_attendance", "homework", "notes", "top20"] as const;

export const ALL_MODULES: readonly string[] = [...MANDATORY_MODULES, ...OPTIONAL_MODULES];

export const isKnownModule = (key: string): boolean => ALL_MODULES.includes(key);
export const isMandatoryModule = (key: string): boolean => (MANDATORY_MODULES as readonly string[]).includes(key);

/** Every module with its final on/off state. Mandatory modules are always on; unlisted ones default on. */
export function resolveModules(switches: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(ALL_MODULES.map((key) => [key, isMandatoryModule(key) ? true : (switches[key] ?? true)]));
}
