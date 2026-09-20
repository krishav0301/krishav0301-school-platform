"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { createApiClient } from "@/api/client";
import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";
import { CONFIG_CACHE_KEY, applyThemeCss } from "@/theme/boot";
import { themeToCss } from "@/theme/css";

export type PublicConfig = components["schemas"]["PublicConfig"];
export type ConfigStatus = "loading" | "ready" | "unprovisioned" | "unreachable";

export interface ConfigValue {
  status: ConfigStatus;
  config: PublicConfig | null;
  /** A word the school may have renamed, such as `role.student`. Falls back to the key itself. */
  term: (key: string) => string;
  /** Whether this school uses a module. An unknown module counts as off. */
  moduleEnabled: (key: string) => boolean;
  retry: () => void;
}

export const ConfigContext = createContext<ConfigValue | null>(null);

export function useConfig(): ConfigValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error("useConfig must be used inside <ConfigProvider>");
  return value;
}

/** Builds the value the provider shares. Exported so tests can supply a school without the network. */
export function makeConfigValue(status: ConfigStatus, config: PublicConfig | null, retry: () => void = () => {}): ConfigValue {
  return {
    status,
    config,
    term: (key) => config?.terms[key] ?? key,
    moduleEnabled: (key) => config?.modules[key] === true,
    retry,
  };
}

// The copy of the configuration from the last visit lives in localStorage. It is read through
// useSyncExternalStore so the server-built page and the first client render agree (no cache on the
// server), and the cached copy then appears without a flash.
const cacheListeners = new Set<() => void>();
const subscribeToCache = (listener: () => void) => {
  cacheListeners.add(listener);
  return () => void cacheListeners.delete(listener);
};
const readCacheRaw = (): string | null => {
  try {
    return localStorage.getItem(CONFIG_CACHE_KEY);
  } catch {
    return null;
  }
};
const noCacheOnServer = (): string | null => null;

function parseCache(raw: string | null): PublicConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PublicConfig>;
    const usable = typeof parsed.school?.name === "string" && Array.isArray(parsed.sections) && parsed.terms && parsed.modules;
    return usable ? (parsed as PublicConfig) : null;
  } catch {
    return null;
  }
}

function writeCache(config: PublicConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_CACHE_KEY);
  } catch {
    /* storage blocked */
  }
  cacheListeners.forEach((listener) => listener());
}

type Fetched = { status: ConfigStatus; config: PublicConfig | null };

/**
 * Loads the school's configuration (name, sections, wording, modules, theme) from the API and
 * applies its theme. A copy from the last visit shows at once while the fresh one loads. If the
 * network is down, the copy keeps the site usable.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const cachedRaw = useSyncExternalStore(subscribeToCache, readCacheRaw, noCacheOnServer);
  const cached = useMemo(() => parseCache(cachedRaw), [cachedRaw]);
  const [fetched, setFetched] = useState<Fetched>({ status: "loading", config: null });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setFetched({ status: "loading", config: null });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, response } = await createApiClient().GET("/api/config/public");
        if (!active) return;

        if (data) {
          let css: string | null = null;
          try {
            css = data.theme ? themeToCss(data.theme) : null;
          } catch {
            css = null; // a malformed theme falls back to the built-in default rather than breaking the page
          }
          applyThemeCss(css);
          writeCache(data);
          setFetched({ status: "ready", config: data });
        } else if (response.status === 503) {
          applyThemeCss(null);
          writeCache(null);
          setFetched({ status: "unprovisioned", config: null });
        } else {
          setFetched({ status: "unreachable", config: null });
        }
      } catch {
        if (active) setFetched({ status: "unreachable", config: null });
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt]);

  const config = fetched.config ?? (fetched.status === "unprovisioned" ? null : cached);
  const status: ConfigStatus = config ? "ready" : fetched.status;

  const value = useMemo(() => makeConfigValue(status, config, retry), [status, config, retry]);
  // React hoists this into <head>. It is the page's only <title>: Next's own metadata title is left
  // out, because Next rewrites it on every client-side navigation and would undo the school's name.
  return (
    <ConfigContext.Provider value={value}>
      <title>{config?.school.name ?? t("app.defaultTitle")}</title>
      {children}
    </ConfigContext.Provider>
  );
}
