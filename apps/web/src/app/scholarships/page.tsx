"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { ScholarshipsView } from "@/site/ScholarshipsView";
import { SiteFrame } from "@/site/SiteFrame";

/** Who can apply for a scholarship: open to everyone, no sign-in. */
export default function ScholarshipsPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <SiteFrame title={t("site.scholarships.title")}>{(site) => <ScholarshipsView site={site} />}</SiteFrame>
      </ConfigGate>
    </PublicShell>
  );
}
