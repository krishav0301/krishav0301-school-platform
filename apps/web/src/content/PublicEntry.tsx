import { t } from "@/i18n/messages";
import { Badge } from "@/ui";

import { KIND_LABEL, contactHref, paragraphs, type Kind } from "./model";
import styles from "./content.module.css";

/**
 * One item as the public reads it: what kind it is, its title, its text, a vacancy's contact, and a line
 * of dates. The Admin's preview and the public notice board both draw this, so the preview is the page.
 *
 * The text is shown as typed: nothing in it is interpreted, and a blank line starts a new paragraph.
 * A contact is a link only when it is an email address or a phone number (`contactHref`).
 */
export function PublicEntry({
  kind,
  title,
  body,
  contact,
  urgent,
  dates,
  holiday = null,
  headingLevel,
  titleIsPlaceholder = false,
}: {
  kind: Kind;
  title: string;
  body: string;
  contact: string | null;
  urgent: boolean;
  /** The line of dates, already in words. */
  dates: string;
  /** A holiday's own days in words (D-094), shown under the title. */
  holiday?: string | null;
  headingLevel: 2 | 3;
  /** The title is a stand-in (the form is still empty), so it is drawn quieter. */
  titleIsPlaceholder?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const href = contact ? contactHref(contact) : null;

  return (
    <article className={styles.entry}>
      <div className={styles.badges}>
        <Badge>{t(KIND_LABEL[kind])}</Badge>
        {urgent ? <Badge>{t("content.urgent")}</Badge> : null}
      </div>
      <Heading className={titleIsPlaceholder ? `${styles.entryTitle} ${styles.muted}` : styles.entryTitle}>{title}</Heading>
      {holiday ? <p className={styles.holiday}>{holiday}</p> : null}
      {paragraphs(body).map((paragraph, index) => (
        <p key={index} className={styles.paragraph}>
          {paragraph}
        </p>
      ))}
      {kind === "vacancy" && contact ? (
        <p className={styles.contact}>
          <span className={styles.contactLabel}>{t("content.contact")}</span>
          {href ? (
            <a href={href} className={styles.contactLink}>
              {contact}
            </a>
          ) : (
            <span>{contact}</span>
          )}
        </p>
      ) : null}
      <p className={styles.muted}>{dates}</p>
    </article>
  );
}
