"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/i18n/messages";

import { SLOGANS, artForPath, type ArtCode } from "./art";
import { Illustration } from "./Illustration";
import styles from "./HeroBand.module.css";

/**
 * The top of every page (D-126, after the PM's reference): a calm band mixed from the theme, with the page's own
 * heading on the left and its illustration standing in the band on the right, cut by its bottom edge. The heading
 * and anything beside it are the page's own children, unchanged. `art` picks the picture; without it the page's
 * address does (`artForPath`); `null` shows none. The picture and its line are decoration, hidden where there is
 * no room (a narrow phone, or enlarged text) and from screen readers.
 */
export function HeroBand({ art, children, className }: { art?: ArtCode | null; children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const code = art === undefined ? artForPath(pathname) : art;
  const slogan = code ? SLOGANS[code] : undefined;
  return (
    <div className={[styles.band, className].filter(Boolean).join(" ")}>
      <div className={styles.text}>{children}</div>
      {code ? (
        <div className={styles.artSide} aria-hidden>
          {slogan ? <p className={styles.slogan}>{t(slogan)}</p> : null}
          <Illustration code={code} className={styles.art} />
        </div>
      ) : null}
    </div>
  );
}
