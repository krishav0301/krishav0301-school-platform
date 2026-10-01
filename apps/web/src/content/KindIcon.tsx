import { KIND_ICON } from "./kind-icons";
import { KIND_TONE, type Kind } from "./model";
import styles from "./website.module.css";

/** A kind's icon on its soft tile, in its own tone. Decorative: the kind's name is always written beside it. */
export function KindTile({ kind, size = "medium" }: { kind: Kind; size?: "small" | "medium" }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={styles.kindTile} data-tone={KIND_TONE[kind]} data-size={size} aria-hidden>
      <Icon />
    </span>
  );
}
