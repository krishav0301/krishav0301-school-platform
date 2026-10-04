"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import { Button, Notice, Skeleton } from "@/ui";

import type { Loaded } from "./client";
import styles from "./setup.module.css";

export type View<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "failed" } | { status: "forbidden" };

/** Loads something now and again on `reload`. Only the newest request may change the screen, so a slow answer never overwrites a newer one. */
export function useLoad<T>(load: () => Promise<Loaded<T>>) {
  const [view, setView] = useState<View<T>>({ status: "loading" });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    let result: Loaded<T>;
    try {
      result = await load();
    } catch {
      // A loader that throws (rather than answering "failed") must not leave the screen loading for good (D-108).
      result = { ok: false, reason: "failed" };
    }
    if (mine !== latest.current) return;
    setView(result.ok ? { status: "ready", data: result.data } : { status: result.reason });
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { view, reload };
}

/** What every setup screen shows while it loads, when it fails, and when the person is not allowed. */
export function Gate<T>({ view, onRetry, children }: { view: View<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (view.status === "loading") {
    return (
      <div role="status" aria-busy="true" className={styles.list}>
        <span className="sr-only">{t("setup.loading")}</span>
        {[0, 1, 2].map((n) => (
          <div key={n} className={styles.item} aria-hidden>
            <Skeleton width="55%" height="1.25rem" />
            <Skeleton width="35%" />
          </div>
        ))}
      </div>
    );
  }
  if (view.status === "forbidden") return <Notice tone="bad">{t("setup.forbidden")}</Notice>;
  if (view.status === "failed") {
    return (
      <Notice tone="bad">
        <p>{t("setup.loadFailed")}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t("setup.retry")}
        </Button>
      </Notice>
    );
  }
  return <>{children(view.data)}</>;
}
