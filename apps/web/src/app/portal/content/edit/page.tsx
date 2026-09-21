"use client";

import { ContentForm } from "@/content/ContentForm";
import { PortalShell } from "@/shell/PortalShell";

/** Make a new item, or edit one (`?id=`). A static export has no dynamic routes, so the id is in the address query. */
export default function EditContentPage() {
  return (
    <PortalShell>
      <ContentForm />
    </PortalShell>
  );
}
