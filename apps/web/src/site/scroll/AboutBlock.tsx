"use client";

import { t } from "@/i18n/messages";
import { Reach } from "@/site/Reach";

import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

/** Where the school is and how to reach it, with its story. Shows only what the school has given. Nothing is embedded from elsewhere. */
export function AboutBlock({ address, phones, about }: { address: string; phones: string[]; about: { story?: string; facebook?: string; mapQuery?: string } }) {
  const ref = useReveal<HTMLDivElement>();
  const mapHref = about.mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(about.mapQuery)}` : null;
  return (
    <div ref={ref} className={styles.reveal}>
      <h2 className={styles.sectionTitle}>{t("scroll.about.title")}</h2>
      {about.story ? <p className={styles.aboutStory}>{about.story}</p> : null}
      <dl className={styles.facts}>
        <div>
          <dt>{t("scroll.about.address")}</dt>
          <dd>{address}</dd>
        </div>
        {phones.length > 0 ? (
          <div>
            <dt>{t("scroll.about.phone")}</dt>
            <dd>
              {phones.map((phone) => (
                <span key={phone} className={styles.phone}>
                  <Reach value={phone} />
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.aboutLinks}>
        {mapHref ? (
          <a href={mapHref} target="_blank" rel="noopener noreferrer" className={styles.aboutLink}>
            {t("scroll.about.map")}
          </a>
        ) : null}
        {about.facebook ? (
          <a href={about.facebook} target="_blank" rel="noopener noreferrer" className={styles.aboutLink}>
            {t("scroll.about.facebook")}
          </a>
        ) : null}
      </p>
    </div>
  );
}
