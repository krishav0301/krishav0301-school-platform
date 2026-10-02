"use client";

import { usePathname } from "next/navigation";

import { seesAccessCentre } from "@/people/access-model";
import { PeopleAccess } from "@/people/PeopleAccess";
import { PeopleTabs } from "@/people/PeopleTabs";
import { StaffScreen } from "@/people/StaffScreen";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";

/**
 * People. The Principal (Admin) and Support get People & Access (D-099), their access-control centre; a Co-ordinator
 * keeps the screens where they add and manage teachers and give them their teaching. Who may see or change what is
 * decided by the API; this only chooses the screen.
 */
export default function PeoplePage() {
  const pathname = usePathname();
  const { me } = useSession();
  return (
    <PortalShell>
      {seesAccessCentre(me?.roles ?? []) ? (
        <PeopleAccess />
      ) : (
        <>
          <PeopleTabs pathname={pathname} />
          <StaffScreen />
        </>
      )}
    </PortalShell>
  );
}
