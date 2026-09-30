"use client";

import { ClassworkLayout } from "@/classwork/ClassworkTabs";
import { ActivityScreen } from "@/classwork/ActivityScreen";

/** Classwork (D-071): the daily activity log, for every role in its own way. */
export default function ClassworkPage() {
  return (
    <ClassworkLayout>
      <ActivityScreen />
    </ClassworkLayout>
  );
}
