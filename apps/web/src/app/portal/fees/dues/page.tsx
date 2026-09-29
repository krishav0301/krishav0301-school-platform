"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { DuesScreen } from "@/fees/DuesScreen";

/** The dues list, CSV and reminders (D-078). */
export default function DuesPage() {
  return (
    <FeesLayout>
      <DuesScreen />
    </FeesLayout>
  );
}
