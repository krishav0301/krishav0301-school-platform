"use client";

import { Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { t } from "@/i18n/messages";

import { Button } from "./Button";
import styles from "./AddDialog.module.css";

/**
 * "Add" at the top of a list, opening its form in a pop-up (the PM, 2026-10-01: an add form at the foot of a long page
 * was easy to miss). The browser's own modal dialog: focus moves into it and stays there, Escape closes it, and the
 * page behind is inert. `openNow` opens it once when the page is reached that way (a dashboard quick action, D-089).
 */
export function AddDialog({
  label,
  title,
  openNow = false,
  variant = "primary",
  plus = true,
  icon,
  hideLabel = false,
  ariaLabel,
  children,
}: {
  label: string;
  title: string;
  openNow?: boolean;
  /** One prominent button per view (D-030): a second Add on the same page is `secondary`, a Rename is `quiet`. */
  variant?: "primary" | "secondary" | "quiet";
  /** The plus sign says "adds"; a dialog that changes something already there leaves it out. */
  plus?: boolean;
  /** An icon in place of the plus sign, such as the "more" dots of a row's options. */
  icon?: ReactNode;
  /** Show only the icon; the label is still read out (an icon-only button always has a name). */
  hideLabel?: boolean;
  /** A fuller name for a short button, such as "Rename Bachelor's" for "Rename". */
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  // Asked for by the address, it shows until the person closes it once.
  const [dismissed, setDismissed] = useState(false);
  const shown = open || (openNow && !dismissed);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (shown && !dialog.open) dialog.showModal();
    if (!shown && dialog.open) dialog.close();
  }, [shown]);

  const close = useCallback(() => {
    setOpen(false);
    setDismissed(true);
  }, []);

  return (
    <>
      <Button
        className={styles.trigger}
        variant={variant}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {icon ?? (plus ? <Plus aria-hidden className={styles.icon} /> : null)}
        {hideLabel ? <span className="sr-only">{label}</span> : label}
      </Button>
      <dialog
        ref={ref}
        className={styles.dialog}
        aria-labelledby={titleId}
        onClose={close}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label={t("ui.close")}
          >
            <X aria-hidden className={styles.icon} />
          </button>
        </div>
        <div className={styles.body}>{children(close)}</div>
      </dialog>
    </>
  );
}

/** A page title with its Add button beside it (wrapping under it on a narrow screen). */
export function TitleRow({ children }: { children: ReactNode }) {
  return <div className={styles.titleRow}>{children}</div>;
}
