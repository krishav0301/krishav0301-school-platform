"use client";

import { AuditTrailScreen } from "@/audit/AuditScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The audit trail: every change made in the school (CLAUDE.md section 6, D-102). */
export default function AuditTrailPage() {
  return (
    <PortalShell>
      <AuditTrailScreen />
    </PortalShell>
  );
}
