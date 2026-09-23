import { t } from "@/i18n/messages";

import { Reach } from "./Reach";
import type { SiteContent } from "./model";
import styles from "./site.module.css";

/**
 * The public privacy notice (Release A go-live checklist, D-067). Fixed, product-wide wording (not
 * a school's own CMS content, unlike the other public pages): what this platform collects and why is
 * the same for every school running it. Only the contact details at the end are the school's own.
 */
export function PrivacyView({ schoolName, site }: { schoolName: string; site: SiteContent }) {
  const sections: { title: string; body: string }[] = [
    { title: t("privacy.collect.title"), body: t("privacy.collect.body", { school: schoolName }) },
    { title: t("privacy.security.title"), body: t("privacy.security.body", { school: schoolName }) },
    { title: t("privacy.access.title"), body: t("privacy.access.body") },
    { title: t("privacy.children.title"), body: t("privacy.children.body") },
    { title: t("privacy.cookies.title"), body: t("privacy.cookies.body") },
    { title: t("privacy.retention.title"), body: t("privacy.retention.body", { school: schoolName }) },
    { title: t("privacy.consent.title"), body: t("privacy.consent.body") },
  ];

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{t("privacy.intro", { school: schoolName })}</p>
      <div className={styles.group}>
        {sections.map((section) => (
          <div key={section.title} className={styles.item}>
            <h2 className={styles.itemTitle}>{section.title}</h2>
            <p>{section.body}</p>
          </div>
        ))}
        <div className={styles.item}>
          <h2 className={styles.itemTitle}>{t("privacy.contact.title")}</h2>
          <p>{t("privacy.contact.body", { school: schoolName })}</p>
          <ul className={styles.plain}>
            {site.contact.email ? (
              <li>
                <Reach value={site.contact.email} />
              </li>
            ) : null}
            {site.contact.phones.map((phone) => (
              <li key={phone}>
                <Reach value={phone} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
