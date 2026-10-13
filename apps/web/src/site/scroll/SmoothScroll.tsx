"use client";

import Lenis from "lenis";
import { useEffect } from "react";

import { prefersReducedMotion } from "./motion";

/** Smooth scrolling for the scroll page only. Does nothing when the visitor wants less motion, and stops when the page is left. */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ anchors: true });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
  return null;
}
