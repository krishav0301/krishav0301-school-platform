import type { MessageKey } from "@/i18n/messages";

/**
 * The portal's menu. Modules add their entry here as they are built (an extension "slot" for the
 * menu, D-008). What shows is filtered by role and by the school's module switches. This is only
 * for tidiness: the API decides what a person may actually do (D-025).
 *
 * On a phone the menu is a bottom tab bar, which holds at most `MAX_TABS` entries; from a wide
 * screen it is a sidebar. `OPEN:` when a role could see more than `MAX_TABS`, add a "More" tab
 * (Apple's tab-bar guidance, `tab-bars.md › Avoid overflow tabs`). A test fails first.
 */
export interface NavItem {
  id: string;
  labelKey: MessageKey;
  href: string;
  /** Show only to these roles. Leave out to show to everyone signed in. */
  roles?: readonly string[];
  /** Show only if this school uses this module. An unknown module counts as off. */
  module?: string;
}

export const MAX_TABS = 5;

export const NAV_ITEMS: readonly NavItem[] = [{ id: "dashboard", labelKey: "nav.dashboard", href: "/portal" }];

export function visibleNav<R extends { role: string }>(items: readonly NavItem[], roles: readonly R[], modules: Readonly<Record<string, boolean>>): NavItem[] {
  return items.filter((item) => {
    if (item.roles && !roles.some((r) => item.roles!.includes(r.role))) return false;
    if (item.module && modules[item.module] !== true) return false;
    return true;
  });
}

/** A menu of one entry has nothing to choose between, so it is not shown at all. */
export const showsMenu = (items: readonly NavItem[]): boolean => items.length >= 2;
