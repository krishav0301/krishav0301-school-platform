import type { MessageKey } from "@/i18n/messages";

/**
 * The portal's menu. Modules add their entry here as they are built (an extension "slot" for the
 * menu, D-008). What shows is filtered by role and by the school's module switches. This is only
 * for tidiness: the API decides what a person may actually do (D-025).
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

export const NAV_ITEMS: readonly NavItem[] = [{ id: "dashboard", labelKey: "nav.dashboard", href: "/portal" }];

export function visibleNav<R extends { role: string }>(items: readonly NavItem[], roles: readonly R[], modules: Readonly<Record<string, boolean>>): NavItem[] {
  return items.filter((item) => {
    if (item.roles && !roles.some((r) => item.roles!.includes(r.role))) return false;
    if (item.module && modules[item.module] !== true) return false;
    return true;
  });
}
