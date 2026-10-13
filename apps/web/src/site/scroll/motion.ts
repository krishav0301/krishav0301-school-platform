/** The small decisions behind the scroll page's motion, kept apart from the hooks so they can be checked without a browser. */

/** Whether the visitor's device asks for less motion. False on the server and in a browser that cannot say. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The hero photos change on their own only when there is more than one and motion is allowed. */
export const heroShouldCycle = (count: number, reduced: boolean): boolean => count > 1 && !reduced;

/** The photo after this one, back to the first at the end. */
export const heroIndexAfter = (current: number, count: number): number => (count < 2 ? 0 : (current + 1) % count);

/** A block shows straight away when motion is reduced or the browser cannot watch for it scrolling in. */
export const revealAtOnce = (reduced: boolean, canWatch: boolean): boolean => reduced || !canWatch;
