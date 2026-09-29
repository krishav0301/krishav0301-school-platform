/**
 * NPR on screen, from and to whole paisa (CLAUDE.md section 6: money is whole paisa integers, never floats, shown with
 * Nepali grouping 12,50,000). Only string and integer arithmetic here.
 */
export function formatNpr(paisa: number): string {
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const rupees = String(Math.trunc(abs / 100));
  const cents = String(abs % 100).padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${sign}${grouped}.${cents}`;
}

/** What a person typed ("12,50,000", "1250.5") as whole paisa, or null if it is not a positive amount with at most two decimals. */
export function parseNpr(text: string): number | null {
  const clean = text.trim().replace(/,/g, "");
  const match = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const paisa = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return paisa > 0 ? paisa : null;
}
