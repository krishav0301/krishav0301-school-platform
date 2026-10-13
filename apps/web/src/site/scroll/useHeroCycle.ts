"use client";

import { useEffect, useState } from "react";

import { heroIndexAfter, heroShouldCycle, prefersReducedMotion } from "./motion";

/** The index of the hero photo to show. It stays on the first when there is one photo, or when motion is reduced. */
export function useHeroCycle(count: number, intervalMs = 6000): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!heroShouldCycle(count, prefersReducedMotion())) return;
    const id = window.setInterval(() => setIndex((i) => heroIndexAfter(i, count)), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs]);
  return count < 2 ? 0 : index;
}
