import type { MessageKey } from "@/i18n/messages";

/**
 * The illustrations (D-126). Each has a code, and `docs/illustrations.md` gives the prompt it is drawn from, so a
 * placeholder box showing "P5" says which picture goes there. The same pictures serve every school: they show no
 * school's name, logo or people. P: a portal page's hero; W: a public page's hero; S: the sidebar card; E: an empty list;
 * X: a page that could not load.
 */
export const ART_CODES = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "P13", "P14", "P15", "P16", "P17", "P18", "P19", "P20",
  "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11",
  "S1", "E1", "X2",
] as const;
export type ArtCode = (typeof ART_CODES)[number];

/**
 * The codes whose picture has been added, as `public/illustrations/<code>.webp`. Until a code is listed here its place
 * shows a labelled box. Adding a picture is: save the file, add its code here.
 */
export const ART_READY: ReadonlySet<ArtCode> = new Set<ArtCode>([]);

/** Which hero picture a page shows, by its address: the longest matching start wins. The overview is per role (below). */
const BY_PATH: readonly (readonly [string, ArtCode])[] = [
  ["/portal/people/teaching", "P5"],
  ["/portal/setup/teaching", "P5"],
  ["/portal/classes", "P6"],
  ["/portal/attendance", "P7"],
  ["/portal/classwork", "P8"],
  ["/portal/results", "P9"],
  ["/portal/fees", "P10"],
  ["/portal/admissions", "P11"],
  ["/portal/approvals", "P12"],
  ["/portal/people", "P13"],
  ["/portal/setup", "P14"],
  ["/portal/terms", "P15"],
  ["/portal/reports", "P16"],
  ["/portal/settings", "P17"],
  ["/portal/content", "P18"],
  ["/portal/mailbox", "P19"],
  ["/programmes", "W2"],
  ["/admission", "W3"],
  ["/scholarships", "W4"],
  ["/facilities", "W5"],
  ["/contact", "W6"],
  ["/notices", "W7"],
  ["/apply", "W8"],
  ["/sign-in", "W9"],
  ["/reset-password", "W10"],
  ["/privacy", "W11"],
];

const startsWithPath = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The hero picture for an address, or null where a page has none (the overview chooses by role; "More" is a menu). */
export function artForPath(pathname: string | null): ArtCode | null {
  if (pathname === null) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return "W1";
  let best: readonly [string, ArtCode] | null = null;
  for (const entry of BY_PATH) {
    if (startsWithPath(path, entry[0]) && (best === null || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

/** The overview's picture, by the person's role. */
export const OVERVIEW_ART = { admin: "P1", student: "P2", teacher: "P3", accountant: "P4", coordinator: "P20" } as const satisfies Record<string, ArtCode>;

/** A short, calm line beside each hero picture (the PM asked for them, 2026-10-07). Shown only where there is room. */
export const SLOGANS: Partial<Record<ArtCode, MessageKey>> = {
  P1: "art.slogan.P1",
  P2: "art.slogan.P2",
  P3: "art.slogan.P3",
  P4: "art.slogan.P4",
  P5: "art.slogan.P5",
  P6: "art.slogan.P6",
  P7: "art.slogan.P7",
  P8: "art.slogan.P8",
  P9: "art.slogan.P9",
  P10: "art.slogan.P10",
  P11: "art.slogan.P11",
  P12: "art.slogan.P12",
  P13: "art.slogan.P13",
  P14: "art.slogan.P14",
  P15: "art.slogan.P15",
  P16: "art.slogan.P16",
  P17: "art.slogan.P17",
  P18: "art.slogan.P18",
  P19: "art.slogan.P19",
  P20: "art.slogan.P20",
  W2: "art.slogan.W2",
  W3: "art.slogan.W3",
  W4: "art.slogan.W4",
  W5: "art.slogan.W5",
  W6: "art.slogan.W6",
  W7: "art.slogan.W7",
  W8: "art.slogan.W8",
  W9: "art.slogan.W9",
  W10: "art.slogan.W10",
  W11: "art.slogan.W11",
};
