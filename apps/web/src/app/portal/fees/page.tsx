"use client";

import { FeesLayout } from "@/fees/FeesTabs";
import { FeesHome } from "@/fees/FeesHome";

/** Fees (D-078): a student's own account, or staff finding a student. */
export default function FeesHomePage() {
  return (
    <FeesLayout>
      <FeesHome />
    </FeesLayout>
  );
}
