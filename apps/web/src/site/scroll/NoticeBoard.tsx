"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createApiClient } from "@/api/client";
import { loadPublic } from "@/content/client";
import { formatBsDate, type PublicItem } from "@/content/model";
import { KindChip, UrgentChip } from "@/content/PublicEntry";
import { t } from "@/i18n/messages";
import { Button, Notice, Skeleton, buttonClass } from "@/ui";

import { NoticeReader } from "./NoticeReader";
import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

const ID = /^[0-9a-f]{32}$/;

/** The notice named by `?notice=<id>`, or null for anything else (an id that does not look like one is never used). */
export const openIdFromSearch = (search: string): string | null => {
  const id = new URLSearchParams(search).get("notice");
  return id && ID.test(id) ? id : null;
};

/** The live notice with this id; null when it has ended, was never there, or none was asked for. */
export const pickOpen = (items: PublicItem[], id: string | null): PublicItem | null => (id ? (items.find((item) => item.id === id) ?? null) : null);

/** How many notices the page shows; the rest are on the full list, so the board stays short however many a school posts. */
export const BOARD_LIMIT = 8;

export type BoardStatus = "loading" | "ready" | "failed";

/** The board in each state, drawn from its data so every state can be checked without a network. */
export function NoticeBoardView({
  status,
  items,
  openId,
  onOpen,
  onClose,
  onRetry,
}: {
  status: BoardStatus;
  items: PublicItem[];
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const ref = useReveal<HTMLDivElement>();
  const opened = status === "ready" ? pickOpen(items, openId) : null;
  const shown = items.slice(0, BOARD_LIMIT);
  return (
    <div ref={ref} className={styles.reveal}>
      <h2 className={styles.sectionTitle}>{t("scroll.notices.title")}</h2>
      <p className={styles.sectionLead}>{t("scroll.notices.lead")}</p>

      {status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.noticeList}>
          <span className="sr-only">{t("notices.loading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.noticeRow} aria-hidden>
              <Skeleton width="65%" height="1.25rem" />
            </div>
          ))}
        </div>
      ) : null}

      {status === "failed" ? (
        <Notice tone="bad">
          <p>{t("notices.loadFailed")}</p>
          <Button variant="secondary" onClick={onRetry}>
            {t("notices.retry")}
          </Button>
        </Notice>
      ) : null}

      {status === "ready" && items.length === 0 ? <p className={styles.muted}>{t("notices.empty")}</p> : null}

      {status === "ready" && items.length > 0 ? (
        <ul className={styles.noticeList}>
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.noticeRow} onClick={() => onOpen(item.id)}>
                <span className={styles.noticeMeta}>
                  <KindChip kind={item.kind} />
                  {item.urgent ? <UrgentChip /> : null}
                  <span className={styles.noticeDate}>{formatBsDate(item.publishedOnBs)}</span>
                </span>
                <span className={styles.noticeTitle}>{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.noticeAll}>
        <Link href="/notices" className={buttonClass({ variant: "quiet" })}>
          {t("scroll.notices.all")}
        </Link>
      </p>

      {opened ? <NoticeReader item={opened} onClose={onClose} /> : null}
    </div>
  );
}

// The notice the address asks for (`?notice=<id>`). The server-built page has none, so it starts closed and switches once the browser reports it.
const subscribeToAddress = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const readAddress = () => openIdFromSearch(window.location.search);
const nothingOnServer = () => null;

/** The school's live notices, loaded after the page opens. A title opens the whole post; the address keeps it (`?notice=<id>`). */
export function NoticeBoard() {
  const [api] = useState(() => createApiClient());
  const [view, setView] = useState<{ status: BoardStatus; items: PublicItem[] }>({ status: "loading", items: [] });
  const fromAddress = useSyncExternalStore(subscribeToAddress, readAddress, nothingOnServer);
  // Until the person opens or closes one themselves, the address decides.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const openId = chosen === undefined ? fromAddress : chosen;
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadPublic(api);
    if (mine !== latest.current) return;
    setView(result.ok ? { status: "ready", items: result.items } : { status: "failed", items: [] });
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback((id: string) => {
    setChosen(id);
    window.history.replaceState(null, "", `${window.location.pathname}?notice=${id}#notices`);
  }, []);
  const close = useCallback(() => {
    setChosen(null);
    window.history.replaceState(null, "", `${window.location.pathname}#notices`);
  }, []);
  const retry = useCallback(() => {
    setView({ status: "loading", items: [] });
    void load();
  }, [load]);

  return <NoticeBoardView status={view.status} items={view.items} openId={openId} onOpen={open} onClose={close} onRetry={retry} />;
}
