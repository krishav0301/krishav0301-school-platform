import { describe, expect, it } from "vitest";

import { formatHundredths, parseHundredths, subjectChoices, type Offering, type Subject } from "@/setup/model";

describe("parseHundredths: what a person types becomes whole hundredths", () => {
  it.each([
    ["3", 300],
    ["3.5", 350],
    ["3.75", 375],
    ["0.25", 25],
    ["0", 0],
    [" 4 ", 400],
    ["75", 7500],
    ["1000", 100000],
  ])("accepts %j as %d", (text, expected) => {
    expect(parseHundredths(text)).toBe(expected);
  });

  it.each(["", "  ", "3.756", "-1", "abc", "1e2", "3,5", ".5", "3.", "3 5", "+3", "1234567"])("refuses %j", (text) => {
    expect(parseHundredths(text)).toBeNull();
  });
});

describe("formatHundredths: whole hundredths become what a person reads", () => {
  it.each([
    [375, "3.75"],
    [300, "3"],
    [350, "3.5"],
    [50, "0.5"],
    [5, "0.05"],
    [10, "0.1"],
    [0, "0"],
    [7500, "75"],
    [100000, "1000"],
  ])("%d reads as %j", (hundredths, text) => {
    expect(formatHundredths(hundredths)).toBe(text);
  });

  it("a value that is typed, stored and shown comes back the same", () => {
    for (const text of ["3", "3.5", "3.75", "0.25", "0.05", "75", "12.34"]) expect(formatHundredths(parseHundredths(text)!)).toBe(text);
  });
});

describe("subjectChoices: what a level can still take", () => {
  const subject = (id: string, name: string, over: Partial<Subject> = {}): Subject => ({ id, name, code: null, archived: false, ...over });
  const offering = (subjectId: string): Offering => ({ id: `o-${subjectId}`, subject: subject(subjectId, "x"), creditHundredths: null, group: null, active: true, fullMarksHundredths: 10000, practicalHundredths: null });

  it("leaves out archived subjects and subjects already on the level, names the rest (with the code when there is one), in the order given", () => {
    const subjects = [subject("s1", "Biology", { code: "BIO" }), subject("s2", "Physics", { archived: true }), subject("s3", "Chemistry"), subject("s4", "English")];
    expect(subjectChoices(subjects, [offering("s3")])).toEqual([
      { value: "s1", label: "Biology (BIO)" },
      { value: "s4", label: "English" },
    ]);
  });

  it("a subject whose offering is switched off is still on the level, so it is not offered again", () => {
    const off = { ...offering("s1"), active: false };
    expect(subjectChoices([subject("s1", "Biology")], [off])).toEqual([]);
  });
});
