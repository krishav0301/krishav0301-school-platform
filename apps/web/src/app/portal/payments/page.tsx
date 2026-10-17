"use client";

import { PaymentsScreen } from "@/fees/PaymentsScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The Accountant's Students tab: find a student, record a payment. */
export default function PaymentsPage() {
  return (
    <PortalShell>
      <PaymentsScreen />
    </PortalShell>
  );
}
