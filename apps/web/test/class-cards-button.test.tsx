import { describe, expect, it } from "vitest";

import { classCardsLabel } from "@/results/ClassCardsButton";

/** The whole class's marks cards button on the class sheet (D-195, D-197): its label says what it does, then how far it has got. */
describe("the whole class's marks cards button", () => {
  it("says what it does when idle, that it is getting the cards, then the card it is on", () => {
    expect(classCardsLabel({ making: null, fetching: false })).toBe("Download all marks cards");
    expect(classCardsLabel({ making: null, fetching: true })).toBe("Getting the class's marks cards");
    expect(classCardsLabel({ making: { done: 3, total: 40 }, fetching: true })).toBe("Making card 3 of 40");
  });
});
