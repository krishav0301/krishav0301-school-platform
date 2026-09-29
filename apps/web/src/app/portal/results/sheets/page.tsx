"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { ClassSheetsScreen } from "@/results/StaffScreens";

/** The whole-class sheets. */
export default function ClassSheetsPage() {
  return (
    <ResultsLayout>
      <ClassSheetsScreen />
    </ResultsLayout>
  );
}
