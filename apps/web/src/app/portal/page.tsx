"use client";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";
import { Badge, Card } from "@/ui";

import styles from "./portal.module.css";

function Dashboard() {
  const { me } = useSession();
  const { config, term } = useConfig();
  if (!me) return null;

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
              <Badge tone="primary">{roleName(claim.role)}</Badge> <span className={styles.scope}>{scopeName(claim)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <p className={styles.note}>{t("portal.nothingYet")}</p>
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
