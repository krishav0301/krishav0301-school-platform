import { BellRing, CalendarDays } from "lucide-react";

import { t } from "@/i18n/messages";

import { FormattedText } from "./FormattedText";
import { KIND_ICON } from "./kind-icons";
import { KIND_LABEL, KIND_TONE, contactHref, type Kind } from "./model";
import styles from "./content.module.css";

/** A kind's name with its icon, in its tone (D-098). News and Information keep their blue to the icon (D-030). */
export function KindChip({ kind }: { kind: Kind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={styles.kindChip} data-tone={KIND_TONE[kind]}>
      <Icon aria-hidden />
      {t(KIND_LABEL[kind])}
    </span>
  );
}

/** Urgent, set apart in the theme's red with a bell (D-098). */
export function UrgentChip() {
  return (
    <span className={styles.urgentChip}>
      <BellRing aria-hidden />
      {t("content.urgent")}
    </span>
  );
}

/**
 * One item as the public reads it: what kind it is, its title, its text, a vacancy's contact, and a line
 * of dates. The Admin's preview and the public notice board both draw this, so the preview is the page.
 *
 * The text carries only the few marks of D-098 (bold, italic, underline, lists, links, a heading), drawn as
 * React elements by `FormattedText`; nothing typed is ever run as HTML.
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
        <KindChip kind={kind} />
        {urgent ? <UrgentChip /> : null}
      </div>
      <Heading className={titleIsPlaceholder ? `${styles.entryTitle} ${styles.muted}` : styles.entryTitle}>{title}</Heading>
      {holiday ? <p className={styles.holiday}>{holiday}</p> : null}
      <FormattedText body={body} />
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
      <p className={styles.entryDate}>
        <CalendarDays aria-hidden />
        {dates}
      </p>
    </article>
  );
}
