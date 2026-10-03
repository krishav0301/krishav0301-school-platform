"use client";

import { SignInsScreen } from "@/audit/AuditScreen";
import { PortalShell } from "@/shell/PortalShell";

/** Sign-ins: every sign-in attempt, the failed ones too (CLAUDE.md section 6, D-102). */
export default function SignInsPage() {
  return (
    <PortalShell>
      <SignInsScreen />
    </PortalShell>
  );
}
