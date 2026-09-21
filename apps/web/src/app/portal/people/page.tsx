"use client";

import { StaffScreen } from "@/people/StaffScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The staff: who runs the school's accounts. Who may see or change what is decided by the API; the menu entry is only tidiness. */
export default function PeoplePage() {
  return (
    <PortalShell>
      <StaffScreen />
    </PortalShell>
  );
}
