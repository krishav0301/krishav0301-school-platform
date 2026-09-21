"use client";

import { ContentList } from "@/content/ContentList";
import { PortalShell } from "@/shell/PortalShell";

/** The Admin's list of website content (D-040). Who may see it is decided by the API; the menu entry is only tidiness. */
export default function ContentPage() {
  return (
    <PortalShell>
      <ContentList />
    </PortalShell>
  );
}
