"use client";

import Link from "next/link";
import { useState } from "react";

import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";

import { photoUrl } from "./photos";
import { SECTION_LINKS } from "./section-links";
import styles from "./scroll.module.css";
import { useHeroCycle } from "./useHeroCycle";

export interface HeroImage {
  file: string;
  alt: string;
}

/** The first screen: school photos fading into one another under a shade, the school's name, and the two ways in. */
export function Hero({ schoolName, address, images, folder, tagline, signedIn }: { schoolName: string; address: string; images: HeroImage[]; folder: string; tagline?: string; signedIn: boolean }) {
  const [paused, setPaused] = useState(false);
  const active = useHeroCycle(images.length, 6000, paused);
  return (
    <section id="top" className={styles.hero} aria-label={schoolName}>
      <div className={styles.heroPhotos}>
        {images.map((image, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP in a static export
          <img
            key={image.file}
            src={photoUrl(folder, image.file)}
            alt={i === active ? image.alt : ""}
            className={styles.heroPhoto}
            data-active={i === active ? "true" : "false"}
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
            decoding="async"
          />
        ))}
      </div>
      <div className={styles.heroShade} />
      <div className={styles.heroText}>
        <p className={styles.heroKicker}>{address}</p>
        <h1 className={styles.heroTitle}>{schoolName}</h1>
        {tagline ? <p className={styles.heroTagline}>{tagline}</p> : null}
        <div className={styles.heroActions}>
          <Link href={signedIn ? "/portal" : "/sign-in"} className={buttonClass()}>
            {t(signedIn ? "scroll.portal" : "scroll.signIn")}
          </Link>
          <a href="#admission" className={buttonClass({ variant: "secondary" })}>
            {t("scroll.apply")}
          </a>
        </div>
      </div>
      {images.length > 1 ? (
        <button type="button" className={styles.heroPause} aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
          {t("scroll.pause")}
        </button>
      ) : null}
      <nav className={styles.heroLinks} aria-label={t("scroll.menuLabel")}>
        {SECTION_LINKS.map((link) => (
          <a key={link.id} href={`#${link.id}`} className={styles.heroLink}>
            {t(link.label)}
          </a>
        ))}
      </nav>
    </section>
  );
}
