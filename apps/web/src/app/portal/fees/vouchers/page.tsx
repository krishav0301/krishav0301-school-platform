"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { VouchersScreen } from "@/fees/VouchersScreen";

/** Bank deposits to verify (D-076). */
export default function VouchersPage() {
  return (
    <FeesLayout>
      <VouchersScreen />
    </FeesLayout>
  );
}
