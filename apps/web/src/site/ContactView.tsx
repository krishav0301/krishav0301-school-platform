import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import type { SiteContent } from "./model";
import { Reach } from "./Reach";
import styles from "./site.module.css";

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
