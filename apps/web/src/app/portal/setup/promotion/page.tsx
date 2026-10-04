"use client";

import { PromotionScreen } from "@/promotion/PromotionScreen";
import { SetupLayout } from "@/setup/SetupLayout";

/** Moving students into the next term (D-110). Who may do it is decided by the API. */
export default function PromotionPage() {
  return (
    <SetupLayout>
      <PromotionScreen />
    </SetupLayout>
  );
}
