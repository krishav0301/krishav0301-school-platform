import type { components } from "@/api/schema";

/** The words of the fixed public pages, as the API sends them (`GET /api/site/pages`). */
export type SiteContent = NonNullable<components["schemas"]["SitePages"]["site"]>;
export type Programme = SiteContent["programmes"][number];

/** The programmes under each section's name, in the section's order. One whose section is unknown goes last, with no heading. */
export function groupProgrammes(sections: { key: string; name: string }[], programmes: Programme[]): { name: string | null; items: Programme[] }[] {
  const groups = sections.map((s) => ({ name: s.name as string | null, items: programmes.filter((p) => p.section === s.key) })).filter((g) => g.items.length > 0);
  const known = new Set(sections.map((s) => s.key));
  const rest = programmes.filter((p) => !known.has(p.section));
  return rest.length > 0 ? [...groups, { name: null, items: rest }] : groups;
}
