"use client";

import { AdmissionsLayout } from "@/admissions/AdmissionsLayout";
import { QueueScreen } from "@/admissions/QueueScreen";
import { RegisterScreen } from "@/admissions/RegisterScreen";
import { useSession } from "@/session/SessionProvider";

/** The Co-ordinator's queue. An Accountant has no `admissions.review`, so they land on their own registration form instead. */
export default function AdmissionsPage() {
  const { me } = useSession();
  const isCoordinator = me?.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ?? false;
  return <AdmissionsLayout>{isCoordinator ? <QueueScreen /> : <RegisterScreen canPlace={false} />}</AdmissionsLayout>;
}
