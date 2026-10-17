"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AdminDashboard } from "@/dashboard/AdminDashboard";
import { RoleBriefLinks } from "@/dashboard/RoleBrief";
import { RoleLanding } from "@/dashboard/RoleLanding";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";

/**
 * Each role's home: the Principal's dashboard (D-088); a landing page, a hero and the places to go, for the Co-ordinator, the
 * Teacher and the Student (the PM, 2026-10-17); the Accountant's fees day (D-107). Someone with two roles gets the first
 * one's home, and a landing already lists every place their roles reach.
 */
function Dashboard() {
  const { me } = useSession();
  if (!me) return null;
  const has = (role: string) => me.roles.some((r) => r.role === role);
  if (has("admin") || has("super_admin")) return <AdminDashboard />;
  if (has("coordinator")) return <RoleLanding role="coordinator" />;
  if (has("teacher")) return <RoleLanding role="teacher" />;
  if (has("accountant")) return <AccountantHome student={has("student")} />;
  if (has("student")) return <RoleLanding role="student" />;
  return (
    <Panel>
      <EmptyLine>{t("portal.nothingYet")}</EmptyLine>
    </Panel>
  );
}

/** The Accountant has no Overview: signing in lands on Students, where a payment is recorded (the PM, 2026-10-17). Someone who is also a student keeps their own brief. */
function AccountantHome({ student }: { student: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!student) router.replace("/portal/payments");
  }, [student, router]);
  return student ? (
    <div className={readStyles.page}>
      <RoleBriefLinks role="student" />
    </div>
  ) : null;
}

export default function PortalPage() {
  return (
    <PortalShell>
      <Dashboard />
    </PortalShell>
  );
}
