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

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", href: "/portal" },
  // Phase 2: the Admin edits the public website's content (D-040). Phase 3, slice 4: a Co-ordinator
  // drafts too, and sends a draft for approval instead of publishing it (D-061).
  { id: "content", labelKey: "nav.content", href: "/portal/content", roles: ["coordinator", "admin", "super_admin"] },
  // Phase 3: the academic structure. The Co-ordinator sets it up; the Admin can look (the API decides, D-025).
  { id: "setup", labelKey: "nav.setup", href: "/portal/setup", roles: ["coordinator", "admin", "super_admin"] },
  // Phase 3, slice 3a: the staff. Whoever may add someone (the API decides, D-025).
  { id: "people", labelKey: "nav.people", href: "/portal/people", roles: ["admin", "coordinator", "super_admin"] },
  // Phase 3, slice 4: the Admin's inbox for a Co-ordinator's draft sent for approval (D-061).
  { id: "approvals", labelKey: "nav.approvals", href: "/portal/approvals", roles: ["admin", "super_admin"] },
  // Phase 4: applications, the review queue, walk-ins and student search. Not the Admin or Super
  // Admin: both are already at MAX_TABS, and neither registers or reviews students (D-063).
  // `OPEN:` an Admin's read-only reach into student search has no menu entry yet, the same
  // overflow gap `visibleNav`'s own test already flags for a sixth entry.
  { id: "admissions", labelKey: "nav.admissions", href: "/portal/admissions", roles: ["coordinator", "accountant"] },
];

/** True on an entry's own page and on the pages beneath it. The dashboard is only current on itself. */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleNav<R extends { role: string }>(items: readonly NavItem[], roles: readonly R[], modules: Readonly<Record<string, boolean>>): NavItem[] {
  return items.filter((item) => {
    if (item.roles && !roles.some((r) => item.roles!.includes(r.role))) return false;
    if (item.module && modules[item.module] !== true) return false;
    return true;
  });
}

/** A menu of one entry has nothing to choose between, so it is not shown at all. */
export const showsMenu = (items: readonly NavItem[]): boolean => items.length >= 2;
