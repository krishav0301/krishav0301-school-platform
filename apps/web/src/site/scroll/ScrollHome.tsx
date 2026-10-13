"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import type { SiteContent } from "@/site/model";

import { Hero } from "./Hero";
import { PhotoStrip } from "./PhotoStrip";
import { SchoolBand } from "./SchoolBand";
import { SmoothScroll } from "./SmoothScroll";
import { TopBar } from "./TopBar";
import styles from "./scroll.module.css";

/** A site whose pack chose the scroll layout, with its words. */
export type ScrollSite = SiteContent & { scroll: NonNullable<SiteContent["scroll"]> };

/** `"scroll"` once the words are loaded and say so; a classic school's front page is drawn as before. */
export function chooseHome(view: { status: string; site?: SiteContent }): "scroll" | "classic" | "loading" {
  if (view.status !== "ready" || !view.site) return "loading";
  return view.site.layout === "scroll" && view.site.scroll ? "scroll" : "classic";
}

/**
 * The whole page, drawn from its words and the four blocks that load their own data (classes, notices, admission,
 * about), so every state can be checked without a network. Only this page has the top bar and the full-bleed photo.
 */
export function ScrollHomeView({
  schoolName,
  site,
  signedIn,
  slots,
}: {
  schoolName: string;
  site: ScrollSite;
  signedIn: boolean;
  slots: { batches: ReactNode; notices: ReactNode; admission: ReactNode; about: ReactNode };
}) {
  // The stylesheet hides a block until it scrolls in only when scripts are running, so a page without them shows everything.
  useEffect(() => {
    document.documentElement.classList.add("js");
    return () => document.documentElement.classList.remove("js");
  }, []);

  const { hero, intro } = site.scroll;
  return (
    <div className={styles.page}>
      <SmoothScroll />
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <TopBar schoolName={schoolName} signedIn={signedIn} />
      <main id="main">
        <Hero schoolName={schoolName} address={site.contact.address} images={hero.images} tagline={hero.tagline} signedIn={signedIn} />
        <SchoolBand intro={intro} />
        <PhotoStrip images={hero.images} />
        {slots.batches}
        <section id="notices" className={styles.section}>
          {slots.notices}
        </section>
        <section id="admission" className={styles.section}>
          {slots.admission}
        </section>
        <section id="about" className={styles.section}>
          {slots.about}
        </section>
      </main>
      <footer className={styles.footer}>
        <p>{t("shell.footer", { school: schoolName })}</p>
        <p>
          <Link href="/privacy" prefetch={false} className={styles.footerLink}>
            {t("shell.privacy")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
