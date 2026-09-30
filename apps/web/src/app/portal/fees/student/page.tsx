"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { StaffAccountScreen } from "@/fees/StaffAccountScreen";

/** One student's fees for staff (?id=, the student). */
export default function StaffAccountPage() {
  return (
    <FeesLayout>
      <StaffAccountScreen />
    </FeesLayout>
  );
}
