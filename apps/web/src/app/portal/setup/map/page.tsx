"use client";

import { SetupLayout } from "@/setup/SetupLayout";
import { SetupMapScreen } from "@/setup/SetupMapScreen";

/** The setup map: a chart of how the whole setup links to students (the PM, 2026-10-10). */
export default function SetupMapPage() {
  return (
    <SetupLayout>
      <SetupMapScreen />
    </SetupLayout>
  );
}
