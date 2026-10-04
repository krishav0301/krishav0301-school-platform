"use client";

import { AdminDashboard } from "@/dashboard/AdminDashboard";
import { CoordinatorDashboard } from "@/dashboard/CoordinatorDashboard";
import { ROLE_BRIEFS, RoleBriefLinks } from "@/dashboard/RoleBrief";
import { AccountantDashboard, StudentDashboard, TeacherDashboard, TeachingPanel } from "@/dashboard/RoleDashboards";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";

type Brief = keyof typeof ROLE_BRIEFS;

/**
 * Each role's home (D-088, D-106, D-107): the Principal's dashboard, the Co-ordinator's school day, a teacher's day,
 * a student's studies, the Accountant's fees. Someone with two roles gets the first home and, under it, what their
 * other role can do.
 */
function Dashboard() {
  const { me } = useSession();
  if (!me) return null;
  const has = (role: string) => me.roles.some((r) => r.role === role);
  if (has("admin") || has("super_admin")) return <AdminDashboard />;
  if (has("coordinator")) return <CoordinatorDashboard extra={has("teacher") ? <TeachingPanel /> : null} />;

  const order: Brief[] = ["teacher", "accountant", "student"];
  const first = order.find(has);
  const others = order.filter((role) => role !== first && has(role));
  const home = first === "teacher" ? <TeacherDashboard /> : first === "accountant" ? <AccountantDashboard /> : first === "student" ? <StudentDashboard /> : null;
  if (!home) {
    return (
      <Panel>
        <EmptyLine>{t("portal.nothingYet")}</EmptyLine>
      </Panel>
    );
  }
  return (
    <div className={readStyles.page}>
      {home}
      {others.map((role) => (
        <RoleBriefLinks key={role} role={role} />
      ))}
    </div>
  );
}

export default function PortalPage() {
  return (
    <PortalShell>
      <Dashboard />
    </PortalShell>
  );
}
