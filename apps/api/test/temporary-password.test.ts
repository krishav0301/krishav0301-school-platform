import { describe, expect, it } from "vitest";

import { passwordProblems, schoolNameWords } from "../src/core/passwords";
import { TEMPORARY_PASSWORD_ALPHABET, generateTemporaryPassword } from "../src/core/temporary-password";

describe("the temporary password", () => {
  it("is written XXXX-XXXX-XXXX-XXXX, 16 characters in four groups, so it can be read out and typed", () => {
    for (let i = 0; i < 50; i++) expect(generateTemporaryPassword()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });

  it("uses no look-alike characters: no 0, O, 1, I or L", () => {
    expect(TEMPORARY_PASSWORD_ALPHABET).toHaveLength(31);
    for (const banned of ["0", "O", "1", "I", "L"]) expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(banned);
    for (let i = 0; i < 200; i++) expect(generateTemporaryPassword()).not.toMatch(/[01OIL]/);
  });

  it("never repeats: 2000 draws are all different", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(2000);
  });

  it("favours no character: over many draws each one turns up about equally often", () => {
    const counts = new Map<string, number>();
    const draws = 1000;
    for (let i = 0; i < draws; i++) for (const ch of generateTemporaryPassword().replaceAll("-", "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (draws * 16) / TEMPORARY_PASSWORD_ALPHABET.length;
    expect(counts.size).toBe(TEMPORARY_PASSWORD_ALPHABET.length); // every character appears
    for (const [ch, n] of counts) {
      expect(n, ch).toBeGreaterThan(expected * 0.75);
      expect(n, ch).toBeLessThan(expected * 1.25);
    }
  });

  it("always passes the password policy for an ordinary email and the school's own name", () => {
    const avoid = schoolNameWords(["Royal Softech College", "Royal Softech"]);
    for (let i = 0; i < 200; i++) expect(passwordProblems(generateTemporaryPassword(), "sita.sharma@royalsoftech.example", avoid)).toEqual([]);
  });
});
