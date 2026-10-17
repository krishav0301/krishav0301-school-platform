"use client";

import { DiscountsReportScreen } from "@/fees/DiscountsReportScreen";
import { FeesLayout } from "@/fees/FeesTabs";

/** The Principal's report of discounts given (D-172). */
export default function DiscountsPage() {
  return (
    <FeesLayout>
      <DiscountsReportScreen />
    </FeesLayout>
  );
}
