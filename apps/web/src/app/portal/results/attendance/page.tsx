"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { TermAttendanceScreen } from "@/results/TermAttendanceScreen";

/** The Class Teacher's attendance for an exam's marks card (?class=&exam=). */
export default function TermAttendancePage() {
  return (
    <ResultsLayout>
      <TermAttendanceScreen />
    </ResultsLayout>
  );
}
