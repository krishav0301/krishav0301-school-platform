/**
 * NPR with Nepali grouping (CLAUDE.md section 6: "shown with Nepali grouping (12,50,000)"), from whole paisa. Whole
 * numbers only: the rupees and the paisa are split with integer arithmetic, never a float division.
 */
export function formatNpr(paisa: number): string {
  if (!Number.isInteger(paisa)) throw new Error("Money is whole paisa.");
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const rupees = String(Math.trunc(abs / 100));
  const cents = String(abs % 100).padStart(2, "0");
  // The last three digits, then groups of two: 1,00,00,000.
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${sign}${grouped}.${cents}`;
}
