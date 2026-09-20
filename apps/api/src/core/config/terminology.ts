/**
 * Words a school may rename (for example "Co-ordinator" to "Vice Principal"). Screens ask for a
 * term by key and never type these words themselves. English only for now: the Nepali toggle is
 * deferred, but text already goes through a catalog so it can be added without touching screens.
 */
export const TERM_DEFAULTS = {
  "role.student": "Student",
  "role.teacher": "Teacher",
  "role.coordinator": "Co-ordinator",
  "role.accountant": "Accountant",
  "role.admin": "Admin",
  "term.terminal": "Terminal",
  "term.programme": "Programme",
  "term.level": "Level",
  "term.section": "Section",
} as const;

export type TermKey = keyof typeof TERM_DEFAULTS;

export const isKnownTerm = (key: string): key is TermKey => key in TERM_DEFAULTS;

/** Every term with its final text: the school's override, else the default. */
export function resolveTerms(overrides: Readonly<Record<string, string>>): Record<TermKey, string> {
  const out = { ...TERM_DEFAULTS } as Record<TermKey, string>;
  for (const [key, text] of Object.entries(overrides)) if (isKnownTerm(key)) out[key] = text;
  return out;
}
