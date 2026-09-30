"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { StructuresScreen } from "@/fees/StructuresScreen";

/** This year's fee structures (D-075). */
export default function StructuresPage() {
  return (
    <FeesLayout>
      <StructuresScreen />
    </FeesLayout>
  );
}
