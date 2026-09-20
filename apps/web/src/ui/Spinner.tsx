import styles from "./Spinner.module.css";

/** A small "working" indicator. Give it a label (from the catalog) so screen readers announce it. */
export function Spinner({ label, small = false }: { label?: string; small?: boolean }) {
  return (
    <span
      className={[styles.spinner, small ? styles.small : ""].filter(Boolean).join(" ")}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
