"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { contactHref } from "@/content/model";
import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";
import { useReveal } from "@/site/scroll/useReveal";

import { FacilityGallery } from "./FacilityGallery";
import type { ImmersiveSite } from "./ImmersiveHome";
import { areaTags, programmeCards, splitAccent } from "./model";
import { AccentHeading, Photo } from "./parts";
import styles from "./immersive.module.css";

/** A block that fades up the first time it scrolls into view (only where scripts run and motion is allowed). */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={[styles.reveal, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/** The first screen: the school's picture under a dark wash (a plain gradient when it has none), the headline large, one line under it and one button. It stays put while the page slides up over it. */
export function Hero({ site }: { site: ImmersiveSite }) {
  const { before, accent, after } = splitAccent(site.immersive.hero.headline);
  const { photosFolder } = site.immersive;
  const image = site.immersive.hero.image;
  return (
    <section id="top" className={styles.hero}>
      <div className={styles.heroScene}>
        {image ? <Photo folder={photosFolder} picture={image} className={styles.heroPhoto} priority /> : null}
        <div className={styles.heroShade} aria-hidden />
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            {before}
            {accent ? <span className={styles.accent}>{accent}</span> : null}
            {after}
          </h1>
          <p className={styles.heroTagline}>{site.immersive.hero.tagline}</p>
          <a href="#areas" className={`${buttonClass()} ${styles.pill}`}>
            {t("immersive.learnMore")}
            <ArrowRight aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

/** Light section: the heading, a line, and a tag for each stream, each leading to the programmes. */
export function Areas({ site }: { site: ImmersiveSite }) {
  const { areas } = site.immersive;
  return (
    <section id="areas" className={styles.section}>
      <Reveal className={styles.center}>
        <div className={styles.tags}>
          {areaTags(site).map((tag) => (
            <a key={tag.label} href="#programmes" data-tag className={styles.tag} style={{ ["--tilt" as string]: `${tag.angle}deg` } as CSSProperties}>
              {tag.label}
              <ArrowUpRight aria-hidden />
            </a>
          ))}
        </div>
        <AccentHeading text={areas.heading} />
        <p className={styles.lead}>{areas.intro}</p>
        <a href="#programmes" className={styles.viewAll}>
          {t("immersive.viewAll")}
        </a>
      </Reveal>
    </section>
  );
}

/** Light section: the heading, a line, and the facilities as tiles that move sideways. */
export function Facilities({ site }: { site: ImmersiveSite }) {
  const { facilities, photosFolder } = site.immersive;
  const pictures = new Map((facilities.images ?? []).map((image) => [image.name, { file: image.file, alt: image.alt }]));
  return (
    <section id="facilities" className={`${styles.section} ${styles.tinted}`}>
      <Reveal className={styles.center}>
        <AccentHeading text={facilities.heading} />
        <p className={styles.lead}>{site.facilities.intro}</p>
      </Reveal>
      <FacilityGallery tiles={site.facilities.items.map((item) => ({ name: item.name, body: item.body, picture: pictures.get(item.name) }))} folder={photosFolder} />
    </section>
  );
}

/** Dark section: one card for each programme and the scholarships; each card stays in view while the next slides over it. */
export function Programmes({ site }: { site: ImmersiveSite }) {
  const { programmes, photosFolder } = site.immersive;
  const cards = programmeCards(site);
  return (
    <section id="programmes" className={`${styles.section} ${styles.dark}`}>
      <Reveal className={styles.center}>
        <AccentHeading text={programmes.heading} />
        <p className={styles.lead}>{programmes.intro}</p>
      </Reveal>
      <div className={styles.cards}>
        {cards.map((card, i) => {
          const picture = programmes.images?.[card.key];
          return (
            <article key={card.key} className={styles.card} style={{ ["--i" as string]: i } as CSSProperties}>
              <div className={styles.cardBody}>
                <div className={styles.cardText}>
                  {card.facts.length > 0 ? <p className={styles.eyebrow}>{card.facts.join(" · ")}</p> : null}
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                  {card.options.length > 0 ? (
                    <ul className={styles.chips}>
                      {card.options.map((option) => (
                        <li key={option}>{option}</li>
                      ))}
                    </ul>
                  ) : null}
                  {card.list.length > 0 ? (
                    <ul className={styles.cardList}>
                      {card.list.map((item) => (
                        <li key={item.title}>
                          <strong>{item.title}</strong> {item.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className={`${styles.cardVisual} ${styles.grain}`} data-shade={i % 3}>
                  {picture ? <Photo folder={photosFolder} picture={picture} className={styles.cardPhoto} /> : <span className={styles.visualWord}>{card.visual}</span>}
                </div>
              </div>
              <a href="#admission" data-strip className={styles.strip}>
                {t("immersive.applyNow")}
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Light section: the reasons, as cards of words (no counters and no figures the school has not given). */
export function Why({ site }: { site: ImmersiveSite }) {
  const { why } = site.immersive;
  return (
    <section id="why" className={styles.section}>
      <Reveal className={styles.center}>
        <AccentHeading text={why.heading} />
        {why.intro ? <p className={styles.lead}>{why.intro}</p> : null}
      </Reveal>
      <Reveal>
        <ul className={styles.whyGrid}>
          {why.items.map((item) => (
            <li key={item.title} className={styles.whyCard}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

const reach = (value: string): ReactNode => {
  const href = contactHref(value);
  return href ? (
    <a href={href} className={styles.reach}>
      {value}
    </a>
  ) : (
    value
  );
};

/** Dark gradient section: where the college is and how to reach it. */
export function Contact({ site }: { site: ImmersiveSite }) {
  const { contact } = site;
  return (
    <section id="contact" className={`${styles.section} ${styles.dark} ${styles.grain}`}>
      <Reveal className={styles.center}>
        <AccentHeading text={t("immersive.contact.title")} />
        <dl className={styles.facts}>
          <div>
            <dt>{t("immersive.contact.address")}</dt>
            <dd>{contact.address}</dd>
          </div>
          <div>
            <dt>{t("immersive.contact.phone")}</dt>
            <dd>
              {contact.phones.map((phone) => (
                <span key={phone}>{reach(phone)}</span>
              ))}
            </dd>
          </div>
          {contact.email ? (
            <div>
              <dt>{t("immersive.contact.email")}</dt>
              <dd>{reach(contact.email)}</dd>
            </div>
          ) : null}
          {contact.hours ? (
            <div>
              <dt>{t("immersive.contact.hours")}</dt>
              <dd>{contact.hours}</dd>
            </div>
          ) : null}
        </dl>
      </Reveal>
    </section>
  );
}

/** The foot of the page: the school, the privacy notice, a way to sign in, and Apply once more. */
export function Footer({ schoolName, signedIn }: { schoolName: string; signedIn: boolean }) {
  return (
    <footer className={`${styles.footer} ${styles.grain}`}>
      <p className={styles.footerName}>{t("shell.footer", { school: schoolName })}</p>
      <div className={styles.footerLinks}>
        <Link href="/privacy" prefetch={false} className={styles.footerLink}>
          {t("shell.privacy")}
        </Link>
        <Link href={signedIn ? "/portal" : "/sign-in"} className={styles.footerLink}>
          {t(signedIn ? "scroll.portal" : "scroll.signIn")}
        </Link>
        <a href="#admission" className={styles.footerLink}>
          {t("immersive.apply")}
        </a>
      </div>
    </footer>
  );
}
