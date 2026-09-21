import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};

/**
 * The address's query string (`?id=...`), read in the browser. The page built at deploy time cannot
 * know it (a static export has no per-request server), so on that first pass the answer is `null`
 * ("not known yet") and the browser fills it in as soon as the page is running.
 */
export function useAddressQuery(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => null,
  );
}
