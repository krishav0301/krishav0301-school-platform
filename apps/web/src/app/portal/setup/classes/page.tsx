"use client";

import { ClassesScreen } from "@/classes/ClassesScreen";
import { SetupLayout } from "@/setup/SetupLayout";

/** Setup's Classes tab is the Classes page itself, the same one the Principal reads (the PM, 2026-10-07). */
export default function ClassesPage() {
  return (
    <SetupLayout>
      <ClassesScreen />
    </SetupLayout>
  );
}
