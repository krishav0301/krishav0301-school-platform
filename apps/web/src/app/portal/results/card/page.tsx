"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { MarksCardScreen } from "@/results/OwnResultsScreen";

/** A marks card, printable (?id=). */
export default function MarksCardPage() {
  return (
    <ResultsLayout>
      <MarksCardScreen />
    </ResultsLayout>
  );
}
