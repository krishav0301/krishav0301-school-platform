"use client";

import { useEffect, useState } from "react";

import { heroIndexAfter, heroShouldCycle, prefersReducedMotion } from "./motion";

/** The index of the hero photo to show. It stays where it is when there is one photo, when motion is reduced, or when the visitor has paused it. */
export function useHeroCycle(count: number, intervalMs = 6000, paused = false): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!heroShouldCycle(count, prefersReducedMotion(), paused)) return;
    const id = window.setInterval(() => setIndex((i) => heroIndexAfter(i, count)), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs, paused]);
  return count < 2 ? 0 : index;
}
