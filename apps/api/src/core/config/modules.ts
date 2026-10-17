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
// Elective subjects became switchable on 2026-10-11 (D-142): a school with none has no elective groups or picks.
// The daily activity log became switchable on 2026-10-11 (D-139): a school that only runs results has no daily log.
// RFID cards for tap attendance became a module on 2026-10-17 (D-174). It is the one module that is OFF unless a
// school's pack turns it on, so a school that has not asked for it is unchanged.
export const OPTIONAL_MODULES = ["attendance", "teacher_attendance", "homework", "notes", "top20", "fees", "activity_log", "electives", "card_attendance"] as const;

/** Modules that are off until a pack switches them on; every other optional module is on until a pack switches it off. */
export const OFF_BY_DEFAULT: readonly string[] = ["card_attendance"];

export const ALL_MODULES: readonly string[] = [...MANDATORY_MODULES, ...OPTIONAL_MODULES];

export const isKnownModule = (key: string): boolean => ALL_MODULES.includes(key);
export const isMandatoryModule = (key: string): boolean => (MANDATORY_MODULES as readonly string[]).includes(key);

/** Every module with its final on/off state. Mandatory modules are always on; an unlisted one is on, except those that are off by default. */
export function resolveModules(switches: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(ALL_MODULES.map((key) => [key, isMandatoryModule(key) ? true : (switches[key] ?? !OFF_BY_DEFAULT.includes(key))]));
}
