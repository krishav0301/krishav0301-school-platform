import { describe, expect, it } from "vitest";

import { levelOffer, termMonthsBs } from "@/terms/model";

// D-114 (FUT points 5, 6): a term offers only free levels of its own length.
describe("a term's length in months, from its BS days", () => {
  it("counts whole months and rounds the days left over, as the server does", () => {
    expect(termMonthsBs("2082-04-01", "2082-09-29")).toBe(6); // Shrawan 1 to the end of Poush
    expect(termMonthsBs("2082-04-01", "2082-09-26")).toBe(6); // a few days short still counts
    expect(termMonthsBs("2082-01-01", "2082-12-30")).toBe(12);
    expect(termMonthsBs("2082-10-15", "2083-01-14")).toBe(3); // across the BS new year
  });

  it("is unknown until both days are whole, or when the end is not after the start", () => {
    expect(termMonthsBs("", "2082-09-29")).toBeNull();
    expect(termMonthsBs("2082-04-01", "2082-9")).toBeNull();
    expect(termMonthsBs("2082-09-29", "2082-04-01")).toBeNull();
  });
});

describe("whether a level is offered for a term", () => {
  const level = (usualMonths: number | null) => ({ id: "l", usualMonths });
  it("offers a free level of the term's length", () => expect(levelOffer(level(6), 6, new Map())).toBe("ok"));
  it("hides a level another open term runs", () => expect(levelOffer(level(6), 6, new Map([["l", "Odd"]]))).toBe("taken"));
  it("hides a level with no length", () => expect(levelOffer(level(null), 6, new Map())).toBe("noLength"));
  it("hides a level of another length", () => expect(levelOffer(level(3), 6, new Map())).toBe("otherLength"));
  it("waits for the days before judging length", () => expect(levelOffer(level(3), null, new Map())).toBe("noDays"));
});
