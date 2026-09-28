"use client";

import { MoreScreen } from "@/shell/MoreScreen";
import { PortalShell } from "@/shell/PortalShell";

/** The phone's "More" tab: the places that did not fit in the tab bar. */
export default function MorePage() {
  return (
    <PortalShell>
      <MoreScreen />
    </PortalShell>
  );
}
