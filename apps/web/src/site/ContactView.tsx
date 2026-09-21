import { contactHref } from "@/content/model";
import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import type { SiteContent } from "./model";
import styles from "./site.module.css";

/** A phone number or email as a link only when it is one (`contactHref` builds `tel:` and `mailto:` from checked characters). */
function Reach({ value }: { value: string }) {
  const href = contactHref(value);
  return href ? (
    <a href={href} className={styles.contactLink}>
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}

export function ContactView({ site }: { site: SiteContent }) {
  const { address, phones, email, hours } = site.contact;
  return (
    <Card>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{t("site.address")}</dt>
          <dd>{address}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t("site.phone")}</dt>
          <dd>
            <ul className={styles.plain}>
              {phones.map((phone) => (
                <li key={phone}>
                  <Reach value={phone} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {email ? (
          <div className={styles.fact}>
            <dt>{t("site.email")}</dt>
            <dd>
              <Reach value={email} />
            </dd>
          </div>
        ) : null}
        {hours ? (
          <div className={styles.fact}>
            <dt>{t("site.hours")}</dt>
            <dd>{hours}</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
