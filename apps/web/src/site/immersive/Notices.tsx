"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createApiClient } from "@/api/client";
import { loadPublic } from "@/content/client";
import { formatBsDate, type PublicItem } from "@/content/model";
import { KindChip, UrgentChip } from "@/content/PublicEntry";
import { t } from "@/i18n/messages";
import { BOARD_LIMIT, openIdFromSearch, pickOpen, type BoardStatus } from "@/site/scroll/NoticeBoard";
import { NoticeReader } from "@/site/scroll/NoticeReader";
import { useReveal } from "@/site/scroll/useReveal";
import { Button, Notice, Skeleton, buttonClass } from "@/ui";

import { AccentHeading } from "./parts";
import styles from "./immersive.module.css";

/** The notice board in each state, drawn from its data so every state can be checked without a network. */
export function NoticesView({
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
  return (
    <div ref={ref} className={styles.reveal}>
      <div className={styles.center}>
        <AccentHeading text={t("immersive.notices.title")} />
        <p className={styles.lead}>{t("immersive.notices.lead")}</p>
      </div>

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

      {status === "ready" && items.length === 0 ? <p className={styles.lead}>{t("notices.empty")}</p> : null}

      {status === "ready" && items.length > 0 ? (
        <ul className={styles.noticeList}>
          {items.slice(0, BOARD_LIMIT).map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.noticeRow} onClick={() => onOpen(item.id)}>
                <span className={styles.noticeMeta}>
                  <KindChip kind={item.kind} />
                  {item.urgent ? <UrgentChip /> : null}
                  <span>{formatBsDate(item.publishedOnBs)}</span>
                </span>
                <span className={styles.noticeTitle}>{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.center}>
        <Link href="/notices" className={buttonClass({ variant: "secondary" })}>
          {t("immersive.notices.all")}
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

/** The college's live notices, loaded after the page opens. A title opens the whole post; the address keeps it (`?notice=<id>`). */
export function Notices() {
  const [api] = useState(() => createApiClient());
  const [view, setView] = useState<{ status: BoardStatus; items: PublicItem[] }>({ status: "loading", items: [] });
  const fromAddress = useSyncExternalStore(subscribeToAddress, readAddress, nothingOnServer);
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

  return <NoticesView status={view.status} items={view.items} openId={openId} onOpen={open} onClose={close} onRetry={retry} />;
}
