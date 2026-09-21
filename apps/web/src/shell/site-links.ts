import type { MessageKey } from "@/i18n/messages";

/**
 * The public pages the header and footer link to, in reading order. Home is left out: the school's name is
 * the link to it. A test checks this list against the pages the Worker fills in, so a new public page is
 * not forgotten here.
 */
export const SITE_LINKS: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/programmes", labelKey: "site.programmes.title" },
  { href: "/admission", labelKey: "site.admission.title" },
  { href: "/scholarships", labelKey: "site.scholarships.title" },
  { href: "/facilities", labelKey: "site.facilities.title" },
  { href: "/contact", labelKey: "site.contact.title" },
  { href: "/notices", labelKey: "notices.title" },
];
