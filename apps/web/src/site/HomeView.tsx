import Link from "next/link";

import { t } from "@/i18n/messages";
import { Card, Notice, buttonClass } from "@/ui";

import { groupProgrammes, type SiteContent } from "./model";
import { Reach } from "./Reach";
import { SiteFrameView, type SiteView } from "./SiteFrame";
import styles from "./site.module.css";

/**
 * The home page: admissions first. The headline and summary, one prominent way to apply, any urgent notice,
 * the programmes by section, the admission steps in brief, and how to get in touch. Sign in is not here: it
 * lives in the header and footer, so this page has one main action (D-030).
 */
export function HomeView({ site, sections, urgent }: { site: SiteContent; sections: { key: string; name: string }[]; urgent: { id: string; title: string }[] }) {
  return (
    <div className={styles.home}>
      <Card className={styles.hero}>
        <h1 className={styles.heroTitle}>{site.home.headline}</h1>
        <p className={styles.heroIntro}>{site.home.summary}</p>
        <div className={styles.actions}>
          <Link href="/admission" className={buttonClass()}>
            {t("site.home.apply")}
          </Link>
          <Link href="/notices" className={buttonClass({ variant: "quiet" })}>
            {t("home.notices")}
          </Link>
        </div>
      </Card>

      {urgent.length > 0 ? (
        <Notice title={t("content.urgent")}>
          <ul className={styles.plain}>
            {urgent.map((item) => (
              <li key={item.id}>
                <Link href="/notices" className={styles.contactLink}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.programmes.title")}</h2>
        {groupProgrammes(sections, site.programmes).map((group) => (
          <div key={group.name ?? "other"} className={styles.group}>
            {group.name ? <h3 className={styles.itemTitle}>{group.name}</h3> : null}
            <ul className={styles.programmeList}>
              {group.items.map((programme) => (
                <li key={programme.key}>
                  <Link href={`/programmes#${programme.key}`} className={styles.programmeLink}>
                    <span className={styles.programmeName}>{programme.name}</span>
                    <span className={styles.muted}>{`${programme.affiliation}, ${programme.duration}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <Link href="/programmes" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeProgrammes")}
          </Link>
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.home.apply")}</h2>
        <ol className={styles.briefSteps}>
          {site.admission.steps.map((step, index) => (
            <li key={index}>{step.title}</li>
          ))}
        </ol>
        <div>
          <Link href="/admission" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeAdmission")}
          </Link>
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.contact.title")}</h2>
        <p>{site.contact.address}</p>
        <p>
          <Reach value={site.contact.phones[0]!} />
        </p>
        <div>
          <Link href="/contact" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeContact")}
          </Link>
        </div>
      </section>
    </div>
  );
}

/**
 * Home in each state of loading its words. Until they are ready (or when they cannot be), the school's own
 * name is the heading and the shape of the page or a plain message stands in.
 */
export function HomeFrameView({
  schoolName,
  sections,
  view,
  urgent,
  onRetry,
}: {
  schoolName: string;
  sections: { key: string; name: string }[];
  view: SiteView;
  urgent: { id: string; title: string }[];
  onRetry: () => void;
}) {
  if (view.status === "ready") return <HomeView site={view.site} sections={sections} urgent={urgent} />;
  return (
    <SiteFrameView title={schoolName} view={view} onRetry={onRetry}>
      {() => null}
    </SiteFrameView>
  );
}
