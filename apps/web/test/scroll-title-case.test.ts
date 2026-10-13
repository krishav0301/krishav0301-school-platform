import { describe, expect, it } from "vitest";

import { en } from "@/i18n/messages";

/** Headings are title case (PM, 2026-10-13): every word starts with a capital, except small joining words that are not the first. */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "is", "of", "on", "or", "the", "to", "up"]);
const isTitleCase = (text: string): boolean =>
  text.split(/\s+/).every((word, index) => {
    const bare = word.replace(/^[^A-Za-z]+/, "");
    if (bare === "") return true;
    return index > 0 && SMALL.has(bare.toLowerCase()) ? true : /^[A-Z]/.test(bare);
  });

const HEADINGS = ["scroll.notices.title", "scroll.batches.title", "scroll.admission.title", "scroll.admission.closedTitle", "scroll.admission.doneTitle", "scroll.about.title", "scroll.school.heading", "scroll.unavailable"] as const;

describe("the scroll page's headings", () => {
  it("know what title case is (the check itself)", () => {
    expect(isTitleCase("Apply for Admission")).toBe(true);
    expect(isTitleCase("Apply for admission")).toBe(false);
    expect(isTitleCase("The School")).toBe(true);
    expect(isTitleCase("the School")).toBe(false);
    expect(isTitleCase("Admissions Are Not Open Online Right Now")).toBe(true);
  });

  for (const key of HEADINGS) {
    it(`${key} is in title case`, () => {
      const text = (en as Record<string, string>)[key];
      expect(text, `${key} exists`).toBeTypeOf("string");
      expect(isTitleCase(text!), text).toBe(true);
    });
  }
});
