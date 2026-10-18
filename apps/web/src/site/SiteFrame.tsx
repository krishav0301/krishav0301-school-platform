"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { createApiClient } from "@/api/client";
import { usePageTitle } from "@/config/page-title";
import { t } from "@/i18n/messages";
import { Button, HeroBand, Notice, Skeleton } from "@/ui";

import { loadSite } from "./client";
import type { SiteContent } from "./model";
import styles from "./site.module.css";

export type SiteView = { status: "loading" } | { status: "ready"; site: SiteContent } | { status: "notReady" } | { status: "failed" };

/** Loads the fixed pages' words after the page opens, and can load them again. */
export function useSite(): { view: SiteView; retry: () => void } {
  const [api] = useState(() => createApiClient());
  const [view, setView] = useState<SiteView>({ status: "loading" });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadSite(api);
    if (mine !== latest.current) return;
    setView(!result.ok ? { status: "failed" } : result.site ? { status: "ready", site: result.site } : { status: "notReady" });
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function retry() {
    setView({ status: "loading" });
    void load();
  }
  return { view, retry };
}

/**
 * The heading of a public page and what stands in for its words while they load, fail or do not exist yet.
 * Drawn from a `view` so every state can be checked without a network.
 */
export function SiteFrameView({ title, view, onRetry, children }: { title: string; view: SiteView; onRetry: () => void; children: (site: SiteContent) => ReactNode }) {
  return (
    <>
      <HeroBand>
        <h1 className={styles.pageTitle}>{title}</h1>
      </HeroBand>

      {view.status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.stack}>
          <span className="sr-only">{t("site.loading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.item} aria-hidden>
              <Skeleton width="40%" height="1.25rem" />
              <Skeleton />
              <Skeleton width="70%" />
            </div>
          ))}
        </div>
      ) : null}

      {view.status === "failed" ? (
        <Notice tone="bad">
          <p>{t("site.loadFailed")}</p>
          <Button variant="secondary" onClick={onRetry}>
            {t("site.retry")}
          </Button>
        </Notice>
      ) : null}

      {view.status === "notReady" ? <Notice title={t("site.notReadyTitle")}>{t("site.notReadyBody")}</Notice> : null}

      {view.status === "ready" ? children(view.site) : null}
    </>
  );
}

/** A public page: its heading and tab title, and its words once they arrive. */
export function SiteFrame({ title, children }: { title: string; children: (site: SiteContent) => ReactNode }) {
  usePageTitle(title);
  const { view, retry } = useSite();
  return (
    <SiteFrameView title={title} view={view} onRetry={retry}>
      {children}
    </SiteFrameView>
  );
}
