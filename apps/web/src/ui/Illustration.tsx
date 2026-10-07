import { t } from "@/i18n/messages";

import { ART_READY, type ArtCode } from "./art";
import styles from "./Illustration.module.css";

export type ArtSize = "hero" | "side" | "spot";

/**
 * An illustration's place (D-126). Until its picture is added (`ART_READY`) it is a soft box labelled with its code,
 * so the PM can see which prompt in `docs/illustrations.md` belongs where. Decoration only: hidden from screen readers.
 */
export function Illustration({ code, size = "hero", className }: { code: ArtCode; size?: ArtSize; className?: string }) {
  const classes = [styles.art, className].filter(Boolean).join(" ");
  if (ART_READY.has(code)) {
    // A plain image: the site is a static export, so Next's image optimiser is not available (D-019).
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={classes} data-size={size} src={`/illustrations/${code}.webp`} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <span className={`${classes} ${styles.placeholder}`} data-size={size} data-code={code} aria-hidden>
      <span className={styles.code}>{code}</span>
      <span className={styles.word}>{t("art.placeholder")}</span>
    </span>
  );
}
