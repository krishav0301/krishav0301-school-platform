"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { StructureScreen } from "@/fees/StructureScreen";

/** One fee structure (?id=). */
export default function StructurePage() {
  return (
    <FeesLayout>
      <StructureScreen />
    </FeesLayout>
  );
}
