"use client";

import { StudentRecordCard } from "@/admissions/StudentRecordCard";
import { OwnAttendanceCard } from "@/attendance/OwnAttendanceCard";
import { AdminDashboard } from "@/dashboard/AdminDashboard";
import { ROLE_BRIEFS, RoleBrief } from "@/dashboard/RoleBrief";
import { SchoolDayCard, StudentTodayCard, TeacherTodayCard } from "@/dashboard/TodayCards";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { ChecklistCard } from "@/setup/ChecklistCard";
import { PortalShell } from "@/shell/PortalShell";
import { Badge, Card } from "@/ui";

import styles from "./portal.module.css";

function Dashboard() {
  const { me } = useSession();
  const { config, term } = useConfig();
  if (!me) return null;
  // The Principal (Admin) and Support see the whole school at a glance (D-088).
  if (me.roles.some((r) => r.role === "admin" || r.role === "super_admin")) return <AdminDashboard />;

  // The school's own word for the role ("Vice Principal" for Co-ordinator), or "Support" for the build team.
  const roleName = (role: string) => (role === "super_admin" ? t("portal.support") : term(`role.${role}`));
  const scopeName = (claim: RoleClaim) => {
    if (claim.scope === "institution") return t("portal.scopeInstitution");
    if (claim.scope === "own") return t("portal.scopeOwn");
    if (claim.scope === "assigned") return t("portal.scopeAssigned");
    return t("portal.scopeSection", { section: config?.sections.find((s) => s.key === claim.section)?.name ?? claim.section ?? "" });
  };

  return (
    <>
      <h1 className={styles.title}>{t("portal.welcome", { name: me.name })}</h1>
      <Card aria-labelledby="roles-heading">
        <h2 id="roles-heading" className={styles.heading}>
          {t("portal.roles")}
        </h2>
        <ul className={styles.roles}>
          {me.roles.map((claim) => (
            <li key={`${claim.role}-${claim.scope}-${claim.section ?? ""}`}>
              <Badge>{roleName(claim.role)}</Badge> <span className={styles.scope}>{scopeName(claim)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {/* What each of the person's roles can do, one card per role (the PM, 2026-10-01). */}
      {[...new Set(me.roles.map((r) => r.role))]
        .filter((role): role is keyof typeof ROLE_BRIEFS => role in ROLE_BRIEFS)
        .map((role) => (
          <RoleBrief key={role} role={role} />
        ))}
      {me.roles.some((r) => r.role === "teacher") ? <TeacherTodayCard /> : null}
      {me.roles.some((r) => r.role === "coordinator") ? <SchoolDayCard /> : null}
      {me.roles.some((r) => r.role === "coordinator") ? <ChecklistCard /> : null}
      {me.roles.some((r) => r.role === "student") ? <StudentRecordCard /> : null}
      {me.roles.some((r) => r.role === "student") && config?.modules.attendance ? <OwnAttendanceCard /> : null}
      {me.roles.some((r) => r.role === "student") ? <StudentTodayCard /> : null}
      {me.roles.some((r) => r.role in ROLE_BRIEFS) ? null : <p className={styles.note}>{t("portal.nothingYet")}</p>}
    </>
  );
}

export default function PortalPage() {
  return (
    <PortalShell>
      <Dashboard />
    </PortalShell>
  );
}
