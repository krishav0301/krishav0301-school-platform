"use client";

import { ClassworkLayout } from "@/classwork/ClassworkTabs";
import { ClassActivityScreen } from "@/classwork/ClassActivityScreen";

/** One class's activity log (`?id=`). A static export has no dynamic routes, so the id is in the address query. */
export default function ClassActivityPage() {
  return (
    <ClassworkLayout>
      <ClassActivityScreen />
    </ClassworkLayout>
  );
}
