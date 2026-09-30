"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { ResultsHome } from "@/results/ResultsHome";

/** Results: each person's own starting place (Phase 7). */
export default function ResultsPage() {
  return (
    <ResultsLayout>
      <ResultsHome />
    </ResultsLayout>
  );
}
