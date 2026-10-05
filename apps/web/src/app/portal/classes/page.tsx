"use client";

import { ClassesScreen } from "@/classes/ClassesScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The classes a person opens (FUT point 19, D-116). Who sees which is decided by the API. */
export default function ClassesPage() {
  return (
    <PortalShell>
      <ClassesScreen />
    </PortalShell>
  );
}
