import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import { groupProgrammes, type SiteContent } from "./model";
import styles from "./site.module.css";

/** The programmes, each a card with an anchor (`/programmes#bbs`), grouped under their section. */
export function ProgrammesView({ site, sections }: { site: SiteContent; sections: { key: string; name: string }[] }) {
  return (
    <div className={styles.stack}>
      {groupProgrammes(sections, site.programmes).map((group) => (
        <section key={group.name ?? "other"} className={styles.group}>
          {group.name ? <h2 className={styles.groupTitle}>{group.name}</h2> : null}
          {group.items.map((programme) => (
            <Card key={programme.key} id={programme.key} className={styles.anchor}>
              <h3 className={styles.itemTitle}>{programme.name}</h3>
              <p>{programme.summary}</p>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>{t("site.affiliation")}</dt>
                  <dd>{programme.affiliation}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>{t("site.duration")}</dt>
                  <dd>{programme.duration}</dd>
                </div>
                {programme.options.length > 0 ? (
                  <div className={styles.fact}>
                    <dt>{t("site.options")}</dt>
                    <dd>{programme.options.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
