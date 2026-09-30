"use client";

import { ClassworkLayout } from "@/classwork/ClassworkTabs";
import { AssignmentScreen } from "@/classwork/AssignmentScreen";

/** One assignment for its teacher (?id=). A static export has no dynamic routes, so the id is in the address query. */
export default function AssignmentPage() {
  return (
    <ClassworkLayout>
      <AssignmentScreen />
    </ClassworkLayout>
  );
}
