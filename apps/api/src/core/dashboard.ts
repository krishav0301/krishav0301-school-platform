/**
 * The Admin's dashboard is drawn from many modules in ONE database round trip (CLAUDE.md section 4). Each module
 * reads only its own tables (modules never read each other's tables) and offers a part: the statements to run and
 * how to read their results. The dashboard runs every part's statements in one `batch()` and hands each part back
 * its own slice of the results.
 */
export interface DashboardPart<T> {
  statements: D1PreparedStatement[];
  read(results: D1Result[]): T;
}

/** Runs several parts in one batch. Each part sees only the results of its own statements, in order. */
export async function runParts<T extends Record<string, DashboardPart<unknown>>>(
  db: D1Database,
  parts: T,
): Promise<{ [K in keyof T]: T[K] extends DashboardPart<infer R> ? R : never }> {
  const entries = Object.entries(parts);
  const results = await db.batch(entries.flatMap(([, part]) => part.statements));
  const out: Record<string, unknown> = {};
  let at = 0;
  for (const [key, part] of entries) {
    out[key] = part.read(results.slice(at, at + part.statements.length));
    at += part.statements.length;
  }
  return out as { [K in keyof T]: T[K] extends DashboardPart<infer R> ? R : never };
}

/** The rows of one result, typed. */
export const rowsOf = <R>(result: D1Result | undefined): R[] => (result?.results ?? []) as R[];

/** A change from `previous` to `current` as a whole percent, or null when there is nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 100) / previous);
}
