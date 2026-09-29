"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { MarkSheetScreen } from "@/results/MarkSheetScreen";

/** The teacher's marks grid (?class=&subject=&terminal=). */
export default function MarkSheetPage() {
  return (
    <ResultsLayout>
      <MarkSheetScreen />
    </ResultsLayout>
  );
}
