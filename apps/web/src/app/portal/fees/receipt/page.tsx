"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { ReceiptScreen } from "@/fees/ReceiptScreen";

/** A receipt, printable (?id=). */
export default function ReceiptPage() {
  return (
    <FeesLayout>
      <ReceiptScreen />
    </FeesLayout>
  );
}
