import type { SiteContent } from "./model";
import styles from "./site.module.css";

export function FacilitiesView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.facilities.intro}</p>
      <ul className={styles.facilityList}>
        {site.facilities.items.map((item, index) => (
          <li key={index} className={styles.facility}>
            <span className={styles.facilityName}>{item.name}</span>
            {item.body ? <span className={styles.muted}>{item.body}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
