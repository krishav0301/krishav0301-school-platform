"use client";

import { ReportsScreen } from "@/reports/ReportsScreen";
import { PortalShell } from "@/shell/PortalShell";

/** Reports: everything the Principal reads but does not change (D-091). */
export default function ReportsPage() {
  return (
    <PortalShell>
      <ReportsScreen />
    </PortalShell>
  );
}
