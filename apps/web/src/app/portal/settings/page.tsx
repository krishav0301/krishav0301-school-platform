"use client";

import { SettingsScreen } from "@/settings/SettingsScreen";
import { PortalShell } from "@/shell/PortalShell";

/** Settings: your profile, your password, signing out (D-091). */
export default function SettingsPage() {
  return (
    <PortalShell>
      <SettingsScreen />
    </PortalShell>
  );
}
