import { t } from "@/i18n/messages";
import type { SiteContent } from "@/site/model";

/**
 * A heading with one accent word, as the pack writes it: "Explore Our *Programmes*". The page draws the starred word in the
 * accent colour. A heading with no star is whole; a stray star is dropped, so an asterisk is never shown.
 */
export function splitAccent(heading: string): { before: string; accent: string | null; after: string } {
  const match = /^([^*]*)\*([^*\s][^*]*)\*([^*]*)$/.exec(heading);
  if (match) return { before: match[1]!, accent: match[2]!, after: match[3]! };
  return { before: heading.replaceAll("*", ""), accent: null, after: "" };
}

/** Enough tags to say what is taught, few enough that none touches another. */
const MAX_TAGS = 8;

/** How far each tag around the programmes heading leans, in degrees: all different, and the same on every render. */
const TILTS = [-14, 9, -7, 15, -11, 6, -17, 12, -4, 18, -9, 4] as const;

/** The tags around the "Explore" heading: each stream a programme offers, or the programme's own name when it offers none. */
export function areaTags(site: SiteContent): { label: string; angle: number }[] {
  const labels = site.programmes.flatMap((p) => (p.options.length > 0 ? p.options : [p.name])).slice(0, MAX_TAGS);
  return labels.map((label, i) => ({ label, angle: TILTS[i]! }));
}

export interface ProgrammeCard {
  key: string;
  title: string;
  text: string;
  /** Affiliation and duration, for a programme. */
  facts: string[];
  /** The streams a programme offers. */
  options: string[];
  /** A true word set large beside the text when there is no picture: how long a programme is, or Scholarships. */
  visual: string;
  /** The scholarships, for the last card; empty for a programme. */
  list: { title: string; text: string }[];
}

/** One card for each programme, then one for the scholarships. */
export function programmeCards(site: SiteContent): ProgrammeCard[] {
  return [
    ...site.programmes.map((p) => ({ key: p.key, title: p.name, text: p.summary, facts: [p.affiliation, p.duration], options: p.options, visual: p.duration.split("(")[0]!.trim(), list: [] })),
    { key: "scholarships", title: t("immersive.scholarships.title"), text: site.scholarships.intro, facts: [], options: [], visual: t("immersive.scholarships.title"), list: site.scholarships.items.map((i) => ({ title: i.title, text: i.body })) },
  ];
}

/** The sections the menu links to, in the order they appear. Each id is a section's anchor on the page. */
export const MENU_SECTIONS = [
  { id: "programmes", label: "immersive.nav.programmes" },
  { id: "facilities", label: "immersive.nav.facilities" },
  { id: "why", label: "immersive.nav.why" },
  { id: "notices", label: "immersive.nav.notices" },
  { id: "admission", label: "immersive.nav.admission" },
  { id: "contact", label: "immersive.nav.contact" },
] as const;
