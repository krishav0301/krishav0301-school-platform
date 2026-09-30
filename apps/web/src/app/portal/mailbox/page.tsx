"use client";

import { MailboxScreen } from "@/mailbox/MailboxScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The test mailbox: staging only (D-086). */
export default function MailboxPage() {
  return (
    <PortalShell>
      <MailboxScreen />
    </PortalShell>
  );
}
