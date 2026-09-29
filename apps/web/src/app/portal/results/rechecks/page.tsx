"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { RechecksScreen } from "@/results/StaffScreens";

/** Rechecks, and every post-publish change. */
export default function RechecksPage() {
  return (
    <ResultsLayout>
      <RechecksScreen />
    </ResultsLayout>
  );
}
