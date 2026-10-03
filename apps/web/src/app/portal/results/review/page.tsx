"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { ReviewSheetScreen } from "@/results/ReviewScreen";
import { RoleGate } from "@/shell/RoleGate";

/** One mark sheet for the Co-ordinator to check (?id=). */
export default function ReviewSheetPage() {
  return (
    <ResultsLayout>
      <RoleGate roles={["coordinator", "super_admin"]}>
        <ReviewSheetScreen />
      </RoleGate>
    </ResultsLayout>
  );
}
