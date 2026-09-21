"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { FacilitiesView } from "@/site/FacilitiesView";
import { SiteFrame } from "@/site/SiteFrame";

/** What the school offers its students: open to everyone, no sign-in. */
export default function FacilitiesPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <SiteFrame title={t("site.facilities.title")}>{(site) => <FacilitiesView site={site} />}</SiteFrame>
      </ConfigGate>
    </PublicShell>
  );
}
