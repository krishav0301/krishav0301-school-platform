/**
 * The terminal a teacher last worked in (the PM, 2026-10-10): the Results tab opens on it, not on the default. Kept in
 * this browser only; a terminal that is gone is ignored by the caller. Storage can be blocked, so nothing here throws.
 */
export const LAST_TERMINAL_KEY = "school.results.terminal.v1";

export function readLastTerminal(): string | null {
  try {
    return localStorage.getItem(LAST_TERMINAL_KEY);
  } catch {
    return null;
  }
}

export function rememberTerminal(id: string): void {
  try {
    localStorage.setItem(LAST_TERMINAL_KEY, id);
  } catch {
    /* storage blocked: the choice still holds for this visit */
  }
}
