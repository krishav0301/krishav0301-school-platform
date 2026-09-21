import { contactHref } from "@/content/model";

import styles from "./site.module.css";

/** A phone number or email as a link only when it is one (`contactHref` builds `tel:` and `mailto:` from checked characters). */
export function Reach({ value }: { value: string }) {
  const href = contactHref(value);
  return href ? (
    <a href={href} className={styles.contactLink}>
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}
