"use client";

import { t } from "@/i18n/messages";

import { photoUrl } from "./photos";
import styles from "./scroll.module.css";

/** The school's photos in a row that scrolls sideways, by touch, by trackpad or from the keyboard. */
export function PhotoStrip({ images, folder }: { images: { file: string; alt: string }[]; folder: string }) {
  return (
    <div className={styles.strip} role="region" aria-label={t("scroll.strip.label")} tabIndex={0}>
      {images.map((image) => (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP in a static export
        <img key={image.file} src={photoUrl(folder, image.file)} alt={image.alt} className={styles.stripPhoto} loading="lazy" decoding="async" />
      ))}
    </div>
  );
}
