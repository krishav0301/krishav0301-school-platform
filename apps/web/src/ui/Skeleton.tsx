import styles from "./Skeleton.module.css";

/** A grey placeholder shown while content loads. Decorative: pair it with a labelled status. */
export function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden />;
}
