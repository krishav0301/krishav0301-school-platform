"use client";

import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";

import { photoUrl } from "./photos";
import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

export interface ClassCard {
  title: string;
  text: string;
  image?: { file: string; alt: string };
}

/**
 * "Our Classes": on a wide screen the heading, a short line and the Apply button stay in view on the left while a card
 * for each part of school life, with its photo, scrolls past on the right. On a phone the columns stack and nothing sticks.
 * A card whose photo has not been sent yet keeps its words. Shows nothing when there are no cards.
 */
export function ClassCards({ cards, folder }: { cards: ClassCard[]; folder: string }) {
  if (cards.length === 0) return null;
  return (
    <section className={styles.classes} aria-labelledby="classes-title">
      <div className={styles.classesPin}>
        <h2 id="classes-title" className={styles.sectionTitle}>
          {t("scroll.cards.title")}
        </h2>
        <p className={styles.sectionLead}>{t("scroll.cards.lead")}</p>
        <a href="#admission" className={`${buttonClass({ variant: "secondary" })} ${styles.classesApply}`}>
          {t("scroll.apply")}
        </a>
      </div>
      <ol className={styles.classList}>
        {cards.map((card) => (
          <Card key={card.title} card={card} folder={folder} />
        ))}
      </ol>
    </section>
  );
}

function Card({ card, folder }: { card: ClassCard; folder: string }) {
  const ref = useReveal<HTMLLIElement>();
  return (
    <li ref={ref} className={`${styles.classCard} ${styles.reveal}`}>
      {card.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP in a static export
        <img src={photoUrl(folder, card.image.file)} alt={card.image.alt} className={styles.classPhoto} loading="lazy" decoding="async" />
      ) : null}
      <div className={styles.classBody}>
        <h3 className={styles.classTitle}>{card.title}</h3>
        <p className={styles.muted}>{card.text}</p>
      </div>
    </li>
  );
}
