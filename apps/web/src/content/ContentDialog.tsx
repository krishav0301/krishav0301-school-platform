"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Notice, Skeleton } from "@/ui";

import { loadItem } from "./client";
import { ContentEditor } from "./ContentForm";
import { emptyForm, formFromItem, type FlashKind, type FormValues, type Kind } from "./model";
import styles from "./website.module.css";

/** What the pop-up is open for: a new item of a kind, or an existing one by its id. */
export type DialogTarget = { mode: "new"; kind: Kind } | { mode: "edit"; id: string };

type Loaded = { status: "loading" } | { status: "ready"; values: FormValues; live: boolean } | { status: "failed" | "forbidden" | "not_found" };

/**
 * "New website content" and "Edit website content" in the browser's own modal dialog (D-098, after the PM's
 * reference): focus moves in and stays in, Escape closes it, and the page behind is inert. A new item needs no
 * request: the list already knows today's Nepali date and the time now. An existing one is loaded with its text.
 */
export function ContentDialog({
  target,
  todayBs,
  nowTime,
  onClose,
  onSaved,
}: {
  target: DialogTarget;
  todayBs: string | null;
  nowTime: string;
  onClose: () => void;
  onSaved: (outcome: FlashKind) => void;
}) {
  const { api } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded>(() =>
    target.mode === "new" ? { status: "ready", values: emptyForm(todayBs, target.kind, nowTime), live: false } : { status: "loading" },
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (target.mode !== "edit") return;
    let active = true;
    void loadItem(api, target.id).then((result) => {
      if (active) setLoaded(result.ok ? { status: "ready", values: formFromItem(result.item), live: result.item.status === "live" } : { status: result.reason });
    });
    return () => {
      active = false;
    };
  }, [api, target]);

  const isNew = target.mode === "new";
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.dialogHead}>
        <div>
          <h2 id={titleId} className={styles.dialogTitle}>
            {t(isNew ? "contentForm.newTitle" : "contentForm.editTitle")}
          </h2>
          <p className={styles.muted}>{t(isNew ? "contentForm.newSubtitle" : "contentForm.editSubtitle")}</p>
        </div>
        <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={t("ui.close")}>
          <X aria-hidden />
        </button>
      </div>

      {loaded.status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.dialogLoading}>
          <span className="sr-only">{t("contentForm.loading")}</span>
          <Skeleton width="40%" height="1.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="10rem" />
        </div>
      ) : null}
      {loaded.status === "failed" || loaded.status === "forbidden" ? <Notice tone="bad">{t(loaded.status === "forbidden" ? "content.forbidden" : "content.loadFailed")}</Notice> : null}
      {loaded.status === "not_found" ? <Notice tone="bad">{t("contentForm.notFoundBody")}</Notice> : null}
      {loaded.status === "ready" ? (
        <ContentEditor
          id={target.mode === "edit" ? target.id : null}
          initial={loaded.values}
          live={loaded.live}
          onSaved={onSaved}
          onGone={() => setLoaded({ status: "not_found" })}
          onCancel={onClose}
        />
      ) : null}
    </dialog>
  );
}
