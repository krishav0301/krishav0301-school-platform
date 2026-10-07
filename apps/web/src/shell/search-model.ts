/**
 * The search in the top bar (D-127, the PM). It asks only the lists a person can already read, so it finds nothing a
 * person could not reach on a page; the server still checks every list. Pure: who searches what, how a result matches,
 * and where it opens.
 */

export type SearchGroup = "pages" | "classes" | "students" | "staff" | "subjects";

/**
 * Who may search each group, and the permission it rests on (`test/search.test.ts` keeps this in step with the
 * permission matrix). Teachers may search students by name (`students.search`) but cannot open a student's record, so
 * a result would lead nowhere: they are not offered students here.
 */
export const SEARCH_ACCESS = {
  classes: { action: "classes.view", roles: ["teacher", "coordinator", "admin", "super_admin"] },
  students: { action: "students.search", roles: ["coordinator", "accountant", "admin", "super_admin"] },
  staff: { action: "accounts.staff.view", roles: ["coordinator", "admin", "super_admin"] },
  subjects: { action: "setup.subjects.view", roles: ["coordinator", "admin", "super_admin"] },
} as const satisfies Record<Exclude<SearchGroup, "pages">, { action: string; roles: readonly string[] }>;

/** The groups a person searches, in the order they are shown. Everyone finds the pages of their own menu. */
export function groupsFor(roles: readonly { role: string }[]): SearchGroup[] {
  const has = (allowed: readonly string[]) => roles.some((r) => allowed.includes(r.role));
  return ["pages", ...(Object.keys(SEARCH_ACCESS) as (keyof typeof SEARCH_ACCESS)[]).filter((g) => has(SEARCH_ACCESS[g].roles))];
}

/** The field's placeholder names what this person can find (searching.md: show the scope of a search). */
export function placeholderFor(groups: readonly SearchGroup[]): "search.placeholder.all" | "search.placeholder.classes" | "search.placeholder.students" | "search.placeholder.pages" {
  if (groups.includes("staff")) return "search.placeholder.all";
  if (groups.includes("students")) return "search.placeholder.students";
  if (groups.includes("classes")) return "search.placeholder.classes";
  return "search.placeholder.pages";
}

/** Whether the Principal sees the office staff too (a Co-ordinator's staff list is the teachers only). */
export const seesAllStaff = (roles: readonly { role: string }[]) => roles.some((r) => r.role === "admin" || r.role === "super_admin");

/** Typed at least this many letters before the lists are asked. */
export const MIN_CHARS = 2;
/** At most this many results per group. */
export const PER_GROUP = 5;

export interface SearchHit {
  key: string;
  title: string;
  meta?: string;
  href: string;
}

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Every word typed appears somewhere in the fields, in any order and case. */
export function matches(query: string, ...fields: readonly (string | null | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const text = fold(fields.filter(Boolean).join(" "));
  return words.every((w) => text.includes(w));
}

/** Where a student opens: the Accountant's student page is their fees account; everyone else's is the record. */
export function studentHref(roles: readonly { role: string }[], id: string): string {
  const recordRoles = ["coordinator", "admin", "super_admin"];
  return roles.some((r) => recordRoles.includes(r.role)) ? `/portal/admissions/student?id=${id}` : `/portal/fees/student?id=${id}`;
}
