"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { ElectivesScreen } from "@/results/StaffScreens";

/** Elective picks. */
export default function ElectivesPage() {
  return (
    <ResultsLayout>
      <ElectivesScreen />
    </ResultsLayout>
  );
}
