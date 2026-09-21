"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { AdmissionView } from "@/site/AdmissionView";
import { SiteFrame } from "@/site/SiteFrame";

/** How to apply: open to everyone, no sign-in. */
export default function AdmissionPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <SiteFrame title={t("site.admission.title")}>{(site) => <AdmissionView site={site} />}</SiteFrame>
      </ConfigGate>
    </PublicShell>
  );
}
