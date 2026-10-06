"use client";

import { TeachingScreen } from "@/people/TeachingScreen";
import { SetupLayout } from "@/setup/SetupLayout";

/** Teaching as a step of setup (D-114), after the curriculum: one teacher per subject in a class, and each Class Teacher (D-060). */
export default function SetupTeachingPage() {
  return (
    <SetupLayout>
      <TeachingScreen />
    </SetupLayout>
  );
}
