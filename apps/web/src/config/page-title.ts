import { useEffect, useSyncExternalStore } from "react";

/**
 * The tab title. The Worker writes a title into a public page's HTML for crawlers (D-046: "Notices and
 * updates | Example College"), and the app must not undo it when it starts. A page states its own
 * title with `usePageTitle`; `ConfigProvider` shows it before the school's name, in the same form.
 */
export const formatTitle = (page: string, school: string): string => (page ? `${page} | ${school}` : school);

/** A tiny store, so a page can set the title without state living in `ConfigProvider` for it to fight over. */
export function createPageTitleStore() {
  let title = "";
  const listeners = new Set<() => void>();
  const set = (next: string) => {
    if (next === title) return;
    title = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => title,
    set,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Takes the title for a page, and returns how to give it back. Giving back clears it only if the page still holds it. */
    claim(next: string) {
      set(next);
      return () => {
        if (title === next) set("");
      };
    },
  };
}

export const pageTitleStore = createPageTitleStore();

/** The page's own title, or an empty one. On the page built at deploy time it is always empty. */
export const usePageTitleValue = (): string => useSyncExternalStore(pageTitleStore.subscribe, pageTitleStore.get, () => "");

/** Call from a page: its title goes before the school's name for as long as the page is on screen. */
export function usePageTitle(title: string): void {
  useEffect(() => pageTitleStore.claim(title), [title]);
}
