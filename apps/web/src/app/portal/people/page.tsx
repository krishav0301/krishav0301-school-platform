"use client";

import { seesAccessCentre } from "@/people/access-model";
import { PeopleAccess, TeacherScreen } from "@/people/PeopleAccess";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";

/**
 * People. The Principal (Admin) and Support get People & Access (D-099), their access-control centre. A Co-ordinator gets
 * the Teacher page (D-131): the same table, where they add and manage teachers. Who may see or change what is decided by
 * the API; this only chooses the screen.
 */
export default function PeoplePage() {
  const { me } = useSession();
  return <PortalShell>{seesAccessCentre(me?.roles ?? []) ? <PeopleAccess /> : <TeacherScreen />}</PortalShell>;
}
