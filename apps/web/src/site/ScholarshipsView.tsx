import type { SiteContent } from "./model";
import styles from "./site.module.css";

export function ScholarshipsView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.scholarships.intro}</p>
      <ul className={styles.list}>
        {site.scholarships.items.map((item, index) => (
          <li key={index} className={styles.item}>
            <h2 className={styles.itemTitle}>{item.title}</h2>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
