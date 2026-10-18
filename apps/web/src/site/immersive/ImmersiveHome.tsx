"use client";

import { useEffect, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import type { SiteContent } from "@/site/model";
import { anchorFromHash } from "@/site/scroll/anchor";
import { SmoothScroll } from "@/site/scroll/SmoothScroll";

import { Admission } from "./Admission";
import { Notices } from "./Notices";
import { Areas, Contact, Facilities, Footer, Hero, Programmes, Why } from "./Sections";
import { TopBar } from "./TopBar";
import styles from "./immersive.module.css";

/** A school's words once it has chosen the immersive layout: the rest of the site, and the page's own. */
export type ImmersiveSite = SiteContent & { immersive: NonNullable<SiteContent["immersive"]> };

/**
 * The whole page (PM, 2026-10-18, D-178), drawn from its words and the two blocks that load their own data (the notices and the
 * admission form), so every state can be checked without a network. The hero stays in place while the rest of the page, in its
 * rounded sheet, slides up over it; the sections below alternate light and dark; the programme cards stack as you scroll.
 */
export function ImmersiveHomeView({
  schoolName,
  site,
  signedIn,
  slots,
}: {
  schoolName: string;
  site: ImmersiveSite;
  signedIn: boolean;
  slots: { notices: ReactNode; admission: ReactNode };
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

  return (
    <div className={styles.page}>
      <SmoothScroll />
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <TopBar schoolName={schoolName} signedIn={signedIn} />
      <main id="main">
        <Hero site={site} />
        <div className={styles.rise}>
          <Areas site={site} />
          <Facilities site={site} />
          <Programmes site={site} />
          <Why site={site} />
          <section id="notices" className={`${styles.section} ${styles.dark}`}>
            {slots.notices}
          </section>
          <section id="admission" className={styles.section}>
            {slots.admission}
          </section>
          <Contact site={site} />
        </div>
      </main>
      <Footer schoolName={schoolName} signedIn={signedIn} />
    </div>
  );
}

/** The page as a school's visitors get it: the blocks that load their own data, in their places. */
export function ImmersiveHome({ schoolName, site, signedIn }: { schoolName: string; site: ImmersiveSite; signedIn: boolean }) {
  return <ImmersiveHomeView schoolName={schoolName} site={site} signedIn={signedIn} slots={{ notices: <Notices />, admission: <Admission phone={site.contact.phones[0] ?? null} /> }} />;
}
