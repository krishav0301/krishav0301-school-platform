import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import { formatBsDate, holidayLine, type FormValues } from "./model";
import { PublicEntry } from "./PublicEntry";
import styles from "./content.module.css";

/**
 * How an item will read on the website, drawn from what is in the form right now, by the same component
 * the public notice board uses.
 */
export function ContentPreview({ values }: { values: FormValues }) {
  const title = values.title.trim();
  const from = formatBsDate(values.publishOnBs.trim());
  // A holiday shows until its last day, which the server sets (D-094); the preview says the same.
  const holiday = values.kind === "holiday" ? holidayLine(values.holidayFromBs, values.holidayToBs) : null;
  const lastShown = values.kind === "holiday" ? values.holidayToBs.trim() || values.holidayFromBs.trim() : values.hideAfterBs.trim();
  const until = lastShown ? formatBsDate(lastShown) : null;

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
          holiday={holiday}
          dates={until ? t("content.showsFromUntil", { from, until }) : t("content.showsFrom", { from })}
          headingLevel={3}
        />
      </div>
    </Card>
  );
}
