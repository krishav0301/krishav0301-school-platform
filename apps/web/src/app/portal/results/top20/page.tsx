"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { Top20Screen } from "@/results/OwnResultsScreen";

/** The Top 20. */
export default function Top20Page() {
  return (
    <ResultsLayout>
      <Top20Screen />
    </ResultsLayout>
  );
}
