"use client";

import { AdmissionsLayout } from "@/admissions/AdmissionsLayout";
import { QueueScreen } from "@/admissions/QueueScreen";
import { RegisterScreen } from "@/admissions/RegisterScreen";
import { SearchScreen } from "@/admissions/SearchScreen";
import { useSession } from "@/session/SessionProvider";

/**
 * The Co-ordinator's queue. An Accountant has no `admissions.review`, so they land on their own registration form
 * instead; anyone else who may look (the Principal) lands on Student search, never a form (admin FUT F-08).
 */
export default function AdmissionsPage() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const isCoordinator = roles.some((r) => r === "coordinator" || r === "super_admin");
  return <AdmissionsLayout>{isCoordinator ? <QueueScreen /> : roles.includes("accountant") ? <RegisterScreen canPlace={false} /> : <SearchScreen />}</AdmissionsLayout>;
}
