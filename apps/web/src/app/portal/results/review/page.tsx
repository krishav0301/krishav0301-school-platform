"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { ReviewSheetScreen } from "@/results/ReviewScreen";

/** One mark sheet for the Co-ordinator to check (?id=). */
export default function ReviewSheetPage() {
  return (
    <ResultsLayout>
      <ReviewSheetScreen />
    </ResultsLayout>
  );
}
