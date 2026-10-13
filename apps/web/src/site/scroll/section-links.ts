import type { MessageKey } from "@/i18n/messages";

/** The page's sections that the menu and the hero link to. Each id is a section's anchor on the page. */
export const SECTION_LINKS: readonly { id: string; label: MessageKey }[] = [
  { id: "notices", label: "scroll.nav.notices" },
  { id: "admission", label: "scroll.nav.admission" },
  { id: "about", label: "scroll.nav.about" },
];
