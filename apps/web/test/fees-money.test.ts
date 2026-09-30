import { describe, expect, it } from "vitest";

import { formatNpr, parseNpr } from "@/fees/money";

describe("NPR on screen", () => {
  it("shows whole paisa with Nepali grouping", () => {
    expect(formatNpr(125_000_000)).toBe("12,50,000.00");
    expect(formatNpr(1_000_000_000)).toBe("1,00,00,000.00");
    expect(formatNpr(99)).toBe("0.99");
    expect(formatNpr(-5_000)).toBe("-50.00");
  });

  it("reads what a person types into whole paisa, without floats", () => {
    expect(parseNpr("12,50,000")).toBe(125_000_000);
    expect(parseNpr("1250.5")).toBe(125_050);
    expect(parseNpr(" 0.99 ")).toBe(99);
    expect(parseNpr("0.1")).toBe(10);
    expect(parseNpr("")).toBeNull();
    expect(parseNpr("12.345")).toBeNull();
    expect(parseNpr("-5")).toBeNull();
    expect(parseNpr("abc")).toBeNull();
    expect(parseNpr("0")).toBeNull();
  });
});
