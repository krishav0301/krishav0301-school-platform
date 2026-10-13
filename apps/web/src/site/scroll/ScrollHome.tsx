"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { t } from "@/i18n/messages";

import { AboutBlock } from "./AboutBlock";
import { AdmissionBlock } from "./AdmissionBlock";
import { Batches } from "./Batches";
import { Hero } from "./Hero";
import { NoticeBoard } from "./NoticeBoard";
import { PhotoStrip } from "./PhotoStrip";
import { SchoolBand } from "./SchoolBand";
import { SmoothScroll } from "./SmoothScroll";
import { TopBar } from "./TopBar";
import { anchorFromHash } from "./anchor";
import { type ScrollSite } from "./choose-home";
import styles from "./scroll.module.css";

export type { ScrollSite };

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

  // A link such as `/#admission` is opened before this page has drawn its sections, so the browser cannot scroll there by itself.
  useEffect(() => {
    const id = anchorFromHash(window.location.hash);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const { hero, intro, photosFolder: folder } = site.scroll;
  return (
    <div className={styles.page}>
      <SmoothScroll />
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <TopBar schoolName={schoolName} signedIn={signedIn} folder={folder} />
      <main id="main">
        <Hero schoolName={schoolName} address={site.contact.address} images={hero.images} folder={folder} tagline={hero.tagline} signedIn={signedIn} />
        <SchoolBand intro={intro} />
        <PhotoStrip images={hero.images} folder={folder} />
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

/** The page as a school's visitors get it: the blocks that load their own data, in their places. */
export function ScrollHome({ schoolName, site, signedIn }: { schoolName: string; site: ScrollSite; signedIn: boolean }) {
  return (
    <ScrollHomeView
      schoolName={schoolName}
      site={site}
      signedIn={signedIn}
      slots={{
        batches: <Batches batches={site.scroll.batches} />,
        notices: <NoticeBoard />,
        admission: <AdmissionBlock phone={site.contact.phones[0] ?? null} />,
        about: <AboutBlock address={site.contact.address} phones={site.contact.phones} about={site.scroll.about} />,
      }}
    />
  );
}
