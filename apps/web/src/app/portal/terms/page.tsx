"use client";

import { PortalShell } from "@/shell/PortalShell";
import { TermsScreen } from "@/terms/TermsScreen";

/** The Principal's academic terms (D-110). Who may change them is decided by the API; the menu entry is only tidiness. */
export default function TermsPage() {
  return (
    <PortalShell>
      <TermsScreen />
    </PortalShell>
  );
}
