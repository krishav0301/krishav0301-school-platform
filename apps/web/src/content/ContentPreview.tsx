import { t } from "@/i18n/messages";
import { Badge, Card } from "@/ui";

import { KIND_LABEL, formatBsDate, paragraphs, type FormValues } from "./model";
import styles from "./content.module.css";

/**
 * How an item will read on the website, drawn from what is in the form right now. The text is shown as
 * typed (nothing in it is interpreted), and a blank line starts a new paragraph. The same markup is what
 * the public pages will use for the five content types.
 */
export function ContentPreview({ values }: { values: FormValues }) {
  const title = values.title.trim();
  const contact = values.contact.trim();
  const from = formatBsDate(values.publishOnBs.trim());
  const until = values.hideAfterBs.trim() ? formatBsDate(values.hideAfterBs.trim()) : null;

  return (
    <Card aria-labelledby="preview-heading" className={styles.preview}>
      <h2 id="preview-heading" className={styles.previewHeading}>
        {t("contentPreview.heading")}
      </h2>
      <p className={styles.muted}>{t("contentPreview.note")}</p>
      <article className={styles.previewItem}>
        <div className={styles.badges}>
          <Badge>{t(KIND_LABEL[values.kind])}</Badge>
          {values.urgent ? <Badge>{t("content.urgent")}</Badge> : null}
        </div>
        <h3 className={title ? styles.previewTitle : `${styles.previewTitle} ${styles.muted}`}>{title || t("contentPreview.untitled")}</h3>
        {paragraphs(values.body).map((paragraph, index) => (
          <p key={index} className={styles.paragraph}>
            {paragraph}
          </p>
        ))}
        {values.kind === "vacancy" && contact ? <p className={styles.paragraph}>{t("contentPreview.contact", { contact })}</p> : null}
        <p className={styles.muted}>{until ? t("content.showsFromUntil", { from, until }) : t("content.showsFrom", { from })}</p>
      </article>
    </Card>
  );
}
