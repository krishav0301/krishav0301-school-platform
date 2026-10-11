import { describe, expect, it } from "vitest";

import { leaks } from "./leaks";

describe("leaks", () => {
  it("finds a secret that stands alone", () => {
    expect(leaks('{"password":"0806"}', "0806")).toBe(true);
    expect(leaks("your password is 0806.", "0806")).toBe(true);
  });

  it("ignores the same digits inside a longer run of letters or digits", () => {
    expect(leaks("a0806b", "0806")).toBe(false);
    expect(leaks("20260806", "0806")).toBe(false);
    expect(leaks('"id":"x08067"', "0806")).toBe(false);
  });
});
