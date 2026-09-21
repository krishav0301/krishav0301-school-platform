import { describe, expect, it } from "vitest";

import { en } from "@/i18n/messages";
import { CRAWLER_ONLY, SHARED_KEYS, STRINGS } from "../../api/src/modules/site/strings";

/**
 * The Worker writes a plain copy of each public page for crawlers (D-046) using a few words of its own,
 * because it cannot import this app's catalog. These tests keep the two from drifting apart.
 */
describe("the words the server copy of a public page shares with the app", () => {
  it("says exactly what the app's catalog says, for every shared key", () => {
    for (const key of SHARED_KEYS) {
      expect(key in en, `${key} is in the catalog`).toBe(true);
      expect(STRINGS[key], key).toBe(en[key as keyof typeof en]);
    }
  });

  it("covers what a crawler needs to read: the page headings, the empty message, the dates, every kind", () => {
    for (const key of ["home.notices", "notices.title", "notices.intro", "notices.empty", "notices.posted", "notices.postedUntil", "content.contact", "content.urgent", "content.kind.notice", "content.kind.holiday", "content.kind.routine", "content.kind.vacancy", "content.kind.post", "site.programmes.title", "site.admission.title", "site.scholarships.title", "site.facilities.title", "site.contact.title"]) {
      expect(SHARED_KEYS, key).toContain(key);
    }
  });

  it("keeps the words that only crawlers see out of the shared list, so they are not held to the catalog", () => {
    for (const key of Object.keys(CRAWLER_ONLY)) expect(SHARED_KEYS as string[]).not.toContain(key);
  });

  it("speaks the same way as the app: no 'we' or 'our'", () => {
    for (const [key, text] of [...Object.entries(STRINGS), ...Object.entries(CRAWLER_ONLY)]) expect(text, key).not.toMatch(/\b(we|we'll|we're|our|us)\b/i);
  });
});
