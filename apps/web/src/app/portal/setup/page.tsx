"use client";

import { SetupLayout } from "@/setup/SetupLayout";
import { YearsScreen } from "@/setup/YearsScreen";

/** Setup, starting with the academic years. Who may see or change what is decided by the API; the menu entry is only tidiness. */
export default function SetupPage() {
  return (
    <SetupLayout>
      <YearsScreen />
    </SetupLayout>
  );
}
