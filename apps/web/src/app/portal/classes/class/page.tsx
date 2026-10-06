"use client";

import { ClassPageScreen } from "@/classes/ClassesScreen";
import { PortalShell } from "@/shell/PortalShell";

/** One class as a page (`?id=`). A static export has no dynamic routes, so the id is in the address query. */
export default function ClassPage() {
  return (
    <PortalShell>
      <ClassPageScreen />
    </PortalShell>
  );
}
