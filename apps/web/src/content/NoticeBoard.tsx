"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createApiClient } from "@/api/client";
import { usePageTitle } from "@/config/page-title";
import { t } from "@/i18n/messages";
import { Button, Notice, Skeleton } from "@/ui";

import { loadPublic } from "./client";
import { KINDS, KIND_PLURAL_LABEL, formatBsDate, holidayLine, type Kind, type PublicItem } from "./model";
import { PublicEntry } from "./PublicEntry";
import styles from "./content.module.css";

type View = { status: "loading" } | { status: "ready"; items: PublicItem[] } | { status: "failed" };

/**
 * What is on the school's website today: notices, holidays, routines, vacancies and posts. Open to
 * everyone, no sign-in. The words arrive after the page opens (D-039), and the server already leaves out
 * anything not yet started or already ended. The filter shows only the kinds that have something, as
 * real buttons that say whether they are pressed.
 */
export function NoticeBoard() {
  usePageTitle(t("notices.title"));
  const [api] = useState(() => createApiClient());
  const [view, setView] = useState<View>({ status: "loading" });
  const [kind, setKind] = useState<Kind | "">("");
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadPublic(api);
    if (mine !== latest.current) return;
    setView(result.ok ? { status: "ready", items: result.items } : { status: "failed" });
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function retry() {
    setView({ status: "loading" });
    void load();
  }

  return (
    <>
      <div className={styles.boardHeader}>
        <h1 className={styles.title}>{t("notices.title")}</h1>
        <p className={styles.muted}>{t("notices.intro")}</p>
      </div>

      {view.status === "ready" && view.items.length > 0 ? <NoticeList items={view.items} kind={kind} onKind={setKind} /> : null}

      {view.status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.list}>
          <span className="sr-only">{t("notices.loading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.item} aria-hidden>
              <Skeleton width="30%" />
              <Skeleton width="65%" height="1.25rem" />
              <Skeleton />
            </div>
          ))}
        </div>
      ) : null}

      {view.status === "failed" ? (
        <Notice tone="bad">
          <p>{t("notices.loadFailed")}</p>
          <Button variant="secondary" onClick={retry}>
            {t("notices.retry")}
          </Button>
        </Notice>
      ) : null}

      {view.status === "ready" && view.items.length === 0 ? <p className={styles.empty}>{t("notices.empty")}</p> : null}
    </>
  );
}

/**
 * The filter buttons and the items. The buttons appear only when there is more than one kind to choose
 * between, and offer only the kinds that have something. Drawn on its own so it can be checked without a network.
 */
export function NoticeList({ items, kind, onKind }: { items: PublicItem[]; kind: Kind | ""; onKind: (kind: Kind | "") => void }) {
  const present = KINDS.filter((k) => items.some((item) => item.kind === k));
  // A filter that no longer has anything (the list refreshed) falls back to everything.
  const active: Kind | "" = kind !== "" && present.includes(kind) ? kind : "";
  const shown = active ? items.filter((item) => item.kind === active) : items;

  return (
    <>
      {present.length > 1 ? (
        <div role="group" aria-label={t("notices.filterLabel")} className={styles.chips}>
          <button type="button" className={active === "" ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={active === ""} onClick={() => onKind("")}>
            {t("notices.all")}
          </button>
          {present.map((k) => (
            <button key={k} type="button" className={active === k ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={active === k} onClick={() => onKind(k)}>
              {t(KIND_PLURAL_LABEL[k])}
            </button>
          ))}
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {t("notices.count", { count: shown.length })}
      </p>
      <ul className={styles.list}>
        {shown.map((item) => (
          <li key={item.id} className={item.urgent ? `${styles.item} ${styles.urgentItem}` : styles.item}>
            <PublicEntry
              kind={item.kind}
              title={item.title}
              body={item.body}
              contact={item.contact}
              urgent={item.urgent}
              holiday={holidayLine(item.holidayFromBs, item.holidayToBs)}
              dates={
                // A holiday comes off after its own days, so an "until" would only repeat them (D-094).
                item.hideAfterBs && !item.holidayFromBs
                  ? t("notices.postedUntil", { from: formatBsDate(item.publishedOnBs), until: formatBsDate(item.hideAfterBs) })
                  : t("notices.posted", { date: formatBsDate(item.publishedOnBs) })
              }
              headingLevel={2}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
