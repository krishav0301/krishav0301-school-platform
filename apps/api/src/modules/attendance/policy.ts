/**
 * The attendance rules a school may one day set for itself (an extension point, "attendance rules", CLAUDE.md
 * section 2). Seam before builder: one default now, no settings screen until a second school needs one.
 */

/** OPEN: the alert threshold. 75% is the stated placeholder (CLAUDE.md section 9) until the client confirms. */
export const ATTENDANCE_ALERT_THRESHOLD = 75;

/** Present days over marked days, rounded down to a whole percent. No marked days: no percentage, not 0% or 100%. */
export function attendancePercent(present: number, marked: number): number | null {
  if (marked <= 0) return null;
  return Math.floor((present * 100) / marked);
}

/** Below the threshold (never exactly at it). A student with nothing marked yet is not flagged. */
export function belowThreshold(percent: number | null, threshold = ATTENDANCE_ALERT_THRESHOLD): boolean {
  return percent !== null && percent < threshold;
}
