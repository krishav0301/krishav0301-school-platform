import styles from "./sign-in-art.module.css";

/** An open book under a graduation cap, small, for the top of the sign-in card. */
export function BookCapArt({ className }: { className?: string }) {
  return (
    <svg className={[styles.bookCap, className].filter(Boolean).join(" ")} viewBox="0 0 160 96" aria-hidden focusable="false">
      <ellipse className={styles.glow} cx="80" cy="80" rx="64" ry="12" />
      <path className={styles.page} d="M26 50l54 12 54-12v26l-54 12-54-12z" />
      <path className={styles.pageEdge} d="M80 62v26" />
      <path className={styles.cap} d="M80 10l40 16-40 16-40-16z" />
      <path className={styles.capBase} d="M56 34v14c0 6 11 10 24 10s24-4 24-10V34l-24 10z" />
      <path className={styles.tassel} d="M118 28v22" />
      <circle className={styles.tasselEnd} cx="118" cy="54" r="3" />
    </svg>
  );
}
