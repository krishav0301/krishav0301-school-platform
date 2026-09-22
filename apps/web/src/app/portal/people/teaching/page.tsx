"use client";

import { usePathname } from "next/navigation";

import { PeopleTabs } from "@/people/PeopleTabs";
import { TeachingScreen } from "@/people/TeachingScreen";
import { PortalShell } from "@/shell/PortalShell";

/** Teaching (D-060): one teacher per subject in a class, and each class's Class Teacher. */
export default function TeachingPage() {
  const pathname = usePathname();
  return (
    <PortalShell>
      <PeopleTabs pathname={pathname} />
      <TeachingScreen />
    </PortalShell>
  );
}
