import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import { formatBsDate, holidayLine, type FormValues } from "./model";
import { PublicEntry } from "./PublicEntry";
import styles from "./website.module.css";

/**
 * How an item will read on the website, drawn from what is in the form right now, by the same component
 * the public notice board uses.
 */
export function ContentPreview({ values }: { values: FormValues }) {
  const title = values.title.trim();
  const from = formatBsDate(values.publishOnBs.trim());
  // A holiday comes off after its own days (D-094), so, as on the public board, it has no "until".
  const holiday = values.kind === "holiday" ? holidayLine(values.holidayFromBs, values.holidayToBs) : null;
  const hideAfter = values.kind === "holiday" ? "" : values.hideAfterBs.trim();
  const until = hideAfter ? formatBsDate(hideAfter) : null;

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
          // The same date line the public board writes (NoticeList), so the preview is the page.
          dates={until ? t("notices.postedUntil", { from, until }) : t("notices.posted", { date: from })}
          headingLevel={3}
        />
      </div>
    </Card>
  );
}
