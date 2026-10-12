import styles from "./sign-in-art.module.css";

/**
 * Two students in school uniform, drawn as a light vector picture (the PM, 2026-10-12, D-165): a few shapes, no image to
 * download, and every colour from the school's theme, so it follows the school's own palette. It shows nobody's face or name.
 */
export function StudentsArt({ className }: { className?: string }) {
  return (
    <svg className={[styles.students, className].filter(Boolean).join(" ")} viewBox="0 0 440 360" aria-hidden focusable="false">
      <path className={styles.blob} d="M20 330c-8-70 40-120 110-135 60-13 90-60 160-62 70-2 130 50 128 120-1 50-30 90-80 110-50 20-150 25-220 15-50-8-92-20-98-48z" />
      {/* the boy, with a backpack */}
      <g>
        <path className={styles.strap} d="M92 215c-18 20-24 60-20 100" />
        <rect className={styles.bag} x="48" y="222" width="46" height="90" rx="18" />
        <path className={styles.blazer} d="M80 360c-6-62 6-130 70-146 20-5 44-5 64 0 64 16 76 84 70 146z" />
        <path className={styles.shirt} d="M150 214l36 52 36-52c-12-5-24-8-36-8s-24 3-36 8z" />
        <path className={styles.tie} d="M178 244h16l5 56-13 12-13-12z" />
        <rect className={styles.skin} x="170" y="186" width="32" height="30" rx="10" />
        <ellipse className={styles.skin} cx="186" cy="150" rx="46" ry="52" />
        <path className={styles.hair} d="M138 150c-8-52 24-84 62-80 38 4 56 38 44 80-6-22-20-34-40-36-26 2-46 14-66 36z" />
        <circle className={styles.ink} cx="168" cy="154" r="4" />
        <circle className={styles.ink} cx="206" cy="154" r="4" />
        <path className={styles.smile} d="M170 176c8 10 26 10 34 0" />
        <circle className={styles.cheek} cx="156" cy="170" r="7" />
        <circle className={styles.cheek} cx="218" cy="170" r="7" />
      </g>
      {/* the girl, holding two books */}
      <g>
        <path className={styles.hair} d="M262 140c-14 60-6 110 6 140l70 6c12-30 18-92 4-146-16-40-62-40-80 0z" />
        <path className={styles.blazer} d="M236 360c-6-56 6-114 62-128 18-4 38-4 56 0 56 14 68 72 62 128z" />
        <path className={styles.shirt} d="M300 232l30 44 30-44c-10-4-20-6-30-6s-20 2-30 6z" />
        <path className={styles.tie} d="M324 258h12l4 44-10 10-10-10z" />
        <rect className={styles.skin} x="316" y="204" width="28" height="28" rx="10" />
        <ellipse className={styles.skin} cx="330" cy="168" rx="42" ry="48" />
        <path className={styles.hair} d="M290 164c-4-44 20-72 52-68 30 4 46 30 38 68-8-20-22-30-40-32-20 2-36 14-50 32z" />
        <circle className={styles.ink} cx="314" cy="170" r="4" />
        <circle className={styles.ink} cx="348" cy="170" r="4" />
        <path className={styles.smile} d="M316 190c8 9 24 9 32 0" />
        <circle className={styles.cheek} cx="302" cy="184" r="6" />
        <circle className={styles.cheek} cx="360" cy="184" r="6" />
        <rect className={styles.bookA} x="262" y="262" width="82" height="54" rx="6" />
        <rect className={styles.bookB} x="270" y="254" width="82" height="54" rx="6" />
        <path className={styles.arm} d="M246 300c18 14 40 18 60 8" />
      </g>
    </svg>
  );
}

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
