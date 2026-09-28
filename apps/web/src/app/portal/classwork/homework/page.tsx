"use client";

import { ClassworkLayout } from "@/classwork/ClassworkTabs";
import { HomeworkScreen } from "@/classwork/HomeworkScreen";

/** Homework (D-072): set, submitted, reviewed. */
export default function HomeworkPage() {
  return (
    <ClassworkLayout>
      <HomeworkScreen />
    </ClassworkLayout>
  );
}
