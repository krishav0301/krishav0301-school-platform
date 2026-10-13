"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { t } from "@/i18n/messages";

import { photoUrl } from "./photos";
import { SECTION_LINKS } from "./section-links";
import styles from "./scroll.module.css";

/**
 * The bar across the top: the page's sections on the left (behind Menu on a phone), the crest in the middle, and
 * Sign in on the right for everyone (a signed-in person sees Portal instead). It sits over the photo and takes a
 * solid background once the page has scrolled.
 */
export function TopBar({ schoolName, signedIn, folder }: { schoolName: string; signedIn: boolean; folder: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={styles.topBar} data-scrolled={scrolled || open ? "true" : "false"}>
      <nav className={styles.menu} aria-label={t("scroll.menuLabel")}>
        <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)}>
          {t("scroll.menu")}
        </button>
        <ul id={menuId} className={styles.menuList} data-open={open ? "true" : "false"}>
          {SECTION_LINKS.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} className={styles.topLink} onClick={() => setOpen(false)}>
                {t(link.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <a href="#top" className={styles.crest} aria-label={schoolName}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP in a static export */}
        <img src={photoUrl(folder, "crest.webp")} alt="" width={44} height={44} />
      </a>
      <div className={styles.barEnd}>
        <Link href={signedIn ? "/portal" : "/sign-in"} className={styles.topLink}>
          {t(signedIn ? "scroll.portal" : "scroll.signIn")}
        </Link>
      </div>
    </header>
  );
}
