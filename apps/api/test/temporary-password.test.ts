import { describe, expect, it } from "vitest";

import { generateTemporaryPassword } from "../src/core/temporary-password";

describe("the temporary password", () => {
  it("is 4 digits, so it can be read out and typed (the PM, 2026-10-10)", () => {
    for (let i = 0; i < 200; i++) expect(generateTemporaryPassword()).toMatch(/^[0-9]{4}$/);
  });

  it("favours no digit: over many draws each one turns up about equally often", () => {
    const counts = new Map<string, number>();
    const draws = 5000;
    for (let i = 0; i < draws; i++) for (const ch of generateTemporaryPassword()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (draws * 4) / 10;
    expect(counts.size).toBe(10); // every digit appears
    for (const [ch, n] of counts) {
      expect(n, ch).toBeGreaterThan(expected * 0.85);
      expect(n, ch).toBeLessThan(expected * 1.15);
    }
  });

  it("can start with 0, and is not a number that loses it", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000 && seen.size === 0; i++) if (generateTemporaryPassword().startsWith("0")) seen.add("zero");
    expect(seen.size).toBe(1);
  });
});
