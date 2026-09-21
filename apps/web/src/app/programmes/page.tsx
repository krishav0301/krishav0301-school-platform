"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { ProgrammesView } from "@/site/ProgrammesView";
import { SiteFrame } from "@/site/SiteFrame";

function Programmes() {
  const { config } = useConfig();
  return <SiteFrame title={t("site.programmes.title")}>{(site) => <ProgrammesView site={site} sections={config?.sections ?? []} />}</SiteFrame>;
}

/** The programmes the school offers: open to everyone, no sign-in. */
export default function ProgrammesPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <Programmes />
      </ConfigGate>
    </PublicShell>
  );
}
