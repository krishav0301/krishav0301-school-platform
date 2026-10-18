"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { t } from "@/i18n/messages";

import styles from "./immersive.module.css";
import { MENU_SECTIONS } from "./model";

/**
 * The bar across the top: the school's name, Apply and Sign in (Portal for someone signed in), and Menu, which opens the
 * list of sections. It floats over the hero and takes a solid background once the page has scrolled. Both buttons are quiet,
 * so the hero's own button stays the prominent one. Escape closes the menu and returns focus to its button.
 */
export function TopBar({ schoolName, signedIn }: { schoolName: string; signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={styles.topBar} data-scrolled={scrolled || open ? "true" : "false"}>
      <a href="#top" className={styles.brand}>
        {schoolName}
      </a>
      <div className={styles.barActions}>
        <a href="#admission" className={styles.barApply}>
          {t("immersive.apply")}
        </a>
        <Link href={signedIn ? "/portal" : "/sign-in"} className={styles.barLink}>
          {t(signedIn ? "scroll.portal" : "scroll.signIn")}
        </Link>
        <button ref={button} type="button" className={styles.menuButton} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)}>
          {t(open ? "immersive.menuClose" : "immersive.menu")}
        </button>
      </div>
      <nav id={menuId} className={styles.menu} aria-label={t("immersive.nav.label")} data-open={open ? "true" : "false"}>
        <ul>
          {MENU_SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={styles.menuLink} onClick={() => setOpen(false)}>
                {t(section.label)}
              </a>
            </li>
          ))}
          <li className={styles.menuSignIn}>
            <Link href={signedIn ? "/portal" : "/sign-in"} className={styles.menuLink} onClick={() => setOpen(false)}>
              {t(signedIn ? "scroll.portal" : "scroll.signIn")}
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
