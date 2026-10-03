"use client";

import { AdmissionsLayout } from "@/admissions/AdmissionsLayout";
import { RegisterScreen } from "@/admissions/RegisterScreen";
import { useSession } from "@/session/SessionProvider";
import { RoleGate } from "@/shell/RoleGate";

/** The Co-ordinator's walk-in (placed straight into a class) or the Accountant's registration (goes to the queue). */
export default function AdmissionsRegisterPage() {
  const { me } = useSession();
  const isCoordinator = me?.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ?? false;
  return (
    <AdmissionsLayout>
      <RoleGate roles={["coordinator", "super_admin", "accountant"]}>
        <RegisterScreen canPlace={isCoordinator} />
      </RoleGate>
    </AdmissionsLayout>
  );
}
