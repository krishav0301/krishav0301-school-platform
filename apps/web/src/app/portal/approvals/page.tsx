"use client";

import { InboxScreen } from "@/approvals/InboxScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The Admin's approvals inbox (D-061). Who may see it is decided by the API; the menu entry is only tidiness. */
export default function ApprovalsPage() {
  return (
    <PortalShell>
      <InboxScreen />
    </PortalShell>
  );
}
