import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import { formatBsDate, type FormValues } from "./model";
import { PublicEntry } from "./PublicEntry";
import styles from "./content.module.css";

/**
 * How an item will read on the website, drawn from what is in the form right now, by the same component
 * the public notice board uses.
 */
export function ContentPreview({ values }: { values: FormValues }) {
  const title = values.title.trim();
  const from = formatBsDate(values.publishOnBs.trim());
  const until = values.hideAfterBs.trim() ? formatBsDate(values.hideAfterBs.trim()) : null;

  return (
    <Card aria-labelledby="preview-heading" className={styles.preview}>
      <h2 id="preview-heading" className={styles.previewHeading}>
        {t("contentPreview.heading")}
      </h2>
      <p className={styles.muted}>{t("contentPreview.note")}</p>
      <div className={styles.previewItem}>
        <PublicEntry
          kind={values.kind}
          title={title || t("contentPreview.untitled")}
          titleIsPlaceholder={!title}
          body={values.body}
          contact={values.contact.trim() || null}
          urgent={values.urgent}
          dates={until ? t("content.showsFromUntil", { from, until }) : t("content.showsFrom", { from })}
          headingLevel={3}
        />
      </div>
    </Card>
  );
}
