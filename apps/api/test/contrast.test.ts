import { describe, expect, it } from "vitest";

import { contrastRatio, parseHex, relativeLuminance } from "../src/core/theme";

describe("colour parsing", () => {
  it("reads #rrggbb and #rgb", () => {
    expect(parseHex("#1a56db")).toEqual([26, 86, 219]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#0F0")).toEqual([0, 255, 0]);
  });

  it.each(["", "fff", "#ff", "#ffff", "#fffff", "#ggg", "#ffffffff", "rgb(0,0,0)", "red", " #fff", "#fff "])(
    "refuses %j",
    (bad) => {
      expect(parseHex(bad)).toBeNull();
    },
  );
});

describe("luminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
  });
});

describe("contrast ratio, against reference values", () => {
  // Reference values from the WCAG definition; widely published.
  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#ffffff", 1],
    ["#767676", "#ffffff", 4.54], // the lightest grey that passes AA on white
    ["#777777", "#ffffff", 4.48], // one step lighter fails
    ["#ff0000", "#ffffff", 4.0],
    ["#0000ff", "#ffffff", 8.59],
  ])("%s on %s is %s", (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 1);
  });

  it("does not depend on which colour is the text", () => {
    expect(contrastRatio("#1a56db", "#f5f5f7")).toBe(contrastRatio("#f5f5f7", "#1a56db"));
  });

  it("stays between 1 and 21 for any pair of colours", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const colour = () => "#" + Array.from({ length: 6 }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("");
    for (let i = 0; i < 500; i++) {
      const ratio = contrastRatio(colour(), colour());
      expect(ratio).toBeGreaterThanOrEqual(1);
      expect(ratio).toBeLessThanOrEqual(21.0001);
    }
  });

  it("refuses a value that is not a colour instead of guessing", () => {
    expect(() => contrastRatio("blue", "#ffffff")).toThrow(/Not a colour/);
  });
});
