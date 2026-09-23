"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { PrivacyView } from "@/site/PrivacyView";
import { SiteFrame } from "@/site/SiteFrame";

function Privacy() {
  const { config } = useConfig();
  if (!config) return null;
  return <SiteFrame title={t("privacy.title")}>{(site) => <PrivacyView schoolName={config.school.name} site={site} />}</SiteFrame>;
}

/** What the school collects through this site, why, and how it is protected. Open to everyone, no sign-in. */
export default function PrivacyPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <Privacy />
      </ConfigGate>
    </PublicShell>
  );
}
