"use client";

import { useEffect, useRef } from "react";

import { prefersReducedMotion, revealAtOnce } from "./motion";

/**
 * Marks the element revealed when it first scrolls into view. The hidden starting state is only applied by the
 * stylesheet when the page has marked itself as running scripts (`html.js`), so without JavaScript nothing waits for this.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (revealAtOnce(prefersReducedMotion(), typeof IntersectionObserver !== "undefined")) {
      el.dataset.revealed = "true";
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}
