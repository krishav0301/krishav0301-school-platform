"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { ContactView } from "@/site/ContactView";
import { SiteFrame } from "@/site/SiteFrame";

/** How to reach the school: open to everyone, no sign-in. */
export default function ContactPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <SiteFrame title={t("site.contact.title")}>{(site) => <ContactView site={site} />}</SiteFrame>
      </ConfigGate>
    </PublicShell>
  );
}
