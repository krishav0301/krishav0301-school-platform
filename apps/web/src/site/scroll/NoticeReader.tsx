"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatBsDate, holidayLine, type PublicItem } from "@/content/model";
import { PublicEntry } from "@/content/PublicEntry";
import { t } from "@/i18n/messages";
import dialogStyles from "@/ui/AddDialog.module.css";

/** The line of dates under a notice, in words. A holiday comes off after its own days, so an "until" would only repeat them (D-094). */
export function entryDates(item: PublicItem): string {
  return item.hideAfterBs && !item.holidayFromBs
    ? t("notices.postedUntil", { from: formatBsDate(item.publishedOnBs), until: formatBsDate(item.hideAfterBs) })
    : t("notices.posted", { date: formatBsDate(item.publishedOnBs) });
}

/**
 * One whole notice in the browser's own modal dialog (as the Add pop-ups are): focus moves into it and stays there,
 * Escape closes it, and the page behind is inert. It opens when it is drawn and tells its owner when it has closed.
 */
export function NoticeReader({ item, onClose }: { item: PublicItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
  }, []);

  return (
    // data-lenis-prevent: smooth scrolling must leave the wheel to this dialog, or a long notice cannot be read to its end.
    <dialog ref={ref} className={dialogStyles.dialog} aria-label={item.title} onClose={onClose} data-lenis-prevent>
      <div className={dialogStyles.head}>
        <span />
        <button type="button" className={dialogStyles.close} onClick={() => ref.current?.close()} aria-label={t("ui.close")}>
          <X aria-hidden className={dialogStyles.icon} />
        </button>
      </div>
      <div className={dialogStyles.body}>
        <PublicEntry
          kind={item.kind}
          title={item.title}
          body={item.body}
          contact={item.contact}
          urgent={item.urgent}
          holiday={holidayLine(item.holidayFromBs, item.holidayToBs)}
          dates={entryDates(item)}
          headingLevel={2}
        />
      </div>
    </dialog>
  );
}
