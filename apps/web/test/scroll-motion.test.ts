import { afterEach, describe, expect, it } from "vitest";

import { heroIndexAfter, heroShouldCycle, prefersReducedMotion, revealAtOnce } from "@/site/scroll/motion";

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});

describe("reduced motion", () => {
  it("is off on the server, where there is no window", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("follows the visitor's setting", () => {
    g.window = { matchMedia: (q: string) => ({ matches: q.includes("reduce") }) };
    expect(prefersReducedMotion()).toBe(true);
    g.window = { matchMedia: () => ({ matches: false }) };
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is off in a browser with no matchMedia", () => {
    g.window = {};
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("the hero photos", () => {
  it("cycle only when there is more than one and motion is allowed", () => {
    expect(heroShouldCycle(4, false)).toBe(true);
    expect(heroShouldCycle(4, true)).toBe(false);
    expect(heroShouldCycle(1, false)).toBe(false);
    expect(heroShouldCycle(0, false)).toBe(false);
  });

  it("stop cycling when the visitor pauses them, and go on when they play them again", () => {
    expect(heroShouldCycle(4, false, true)).toBe(false);
    expect(heroShouldCycle(4, false, false)).toBe(true);
  });

  it("go on to the next, and wrap round to the first", () => {
    expect(heroIndexAfter(0, 3)).toBe(1);
    expect(heroIndexAfter(2, 3)).toBe(0);
    expect(heroIndexAfter(0, 1)).toBe(0);
  });
});

describe("a block revealing as it scrolls in", () => {
  it("shows at once when motion is reduced, or the browser cannot watch for scrolling", () => {
    expect(revealAtOnce(true, true)).toBe(true);
    expect(revealAtOnce(false, false)).toBe(true);
    expect(revealAtOnce(false, true)).toBe(false);
  });
});
