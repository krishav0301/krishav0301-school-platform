import type { MessageKey } from "@/i18n/messages";

/**
 * The portal's menu. Modules add their entry here as they are built (an extension "slot" for the
 * menu, D-008). What shows is filtered by role and by the school's module switches. This is only
 * for tidiness: the API decides what a person may actually do (D-025).
 *
 * On a phone the menu is a bottom tab bar, which holds at most `MAX_TABS` entries; from a wide
 * screen it is a sidebar that shows every entry. A role with more places than the tab bar holds gets a
 * last "More" tab listing the rest (`splitNav`). Apple advises keeping that rare (`tab-bars.md › Avoid
 * overflow tabs`), so an entry used daily stays a tab and only an entry marked `rarely` moves into More.
 */
export interface NavItem {
  id: string;
  labelKey: MessageKey;
  href: string;
  /** Show only to these roles. Leave out to show to everyone signed in. */
  roles?: readonly string[];
  /** Show only if this school uses this module. An unknown module counts as off. */
  module?: string;
  /** Visited now and then rather than daily (setup, staff, the website): the first to move into More on a phone. */
  rarely?: boolean;
  /** The entry's icon in the sidebar (D-088), by name; the shell maps it to a drawing. */
  icon: NavIcon;
}

export type NavIcon = "overview" | "classes" | "website" | "programs" | "terms" | "setup" | "people" | "approvals" | "admissions" | "attendance" | "classwork" | "fees" | "results" | "reports" | "settings";

export const MAX_TABS = 5;

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", href: "/portal", icon: "overview" },
  // FUT point 19 (D-116): a class as one page, for the staff who work with classes. A teacher sees the classes they teach.
  // D-130 (the PM): the Co-ordinator reaches the same page as Setup's Classes tab, so it is not in their menu.
  { id: "classes", labelKey: "nav.classes", href: "/portal/classes", roles: ["teacher", "admin", "super_admin"], icon: "classes" },
  // Phase 2: the Admin edits the public website's content (D-040). Phase 3, slice 4: a Co-ordinator
  // drafts too, and sends a draft for approval instead of publishing it (D-061).
  { id: "content", labelKey: "nav.content", href: "/portal/content", roles: ["coordinator", "admin", "super_admin"], rarely: true, icon: "website" },
  // D-087/D-088: programmes are the Admin's alone, so the Admin's Setup is just "Programs".
  { id: "programs", labelKey: "nav.programs", href: "/portal/setup/programmes", roles: ["admin"], rarely: true, icon: "programs" },
  // D-110: the Principal makes, opens and closes academic terms; the Co-ordinator reads them in Setup.
  { id: "terms", labelKey: "nav.terms", href: "/portal/terms", roles: ["admin", "super_admin"], rarely: true, icon: "terms" },
  // Phase 3: the academic structure. The Co-ordinator sets it up; the Admin can look (the API decides, D-025).
  { id: "setup", labelKey: "nav.setup", href: "/portal/setup", roles: ["coordinator", "super_admin"], rarely: true, icon: "setup" },
  // Phase 3, slice 3a: the staff. Whoever may add someone (the API decides, D-025).
  { id: "people", labelKey: "nav.people", href: "/portal/people", roles: ["admin", "coordinator", "super_admin"], rarely: true, icon: "people" },
  // Phase 3, slice 4: the Admin's inbox for a Co-ordinator's draft sent for approval (D-061).
  { id: "approvals", labelKey: "nav.approvals", href: "/portal/approvals", roles: ["admin", "super_admin"], icon: "approvals" },
  // Phase 4: applications, the review queue, walk-ins and the Students page. The Principal reads students here (D-118),
  // with each student's fees on their record, since Fees left the Principal's menu (D-121). Not the Super Admin.
  { id: "admissions", labelKey: "nav.admissions", href: "/portal/admissions", roles: ["coordinator", "accountant", "admin"], icon: "admissions" },
  // D-121 (the PM, 2026-10-06): the Principal reaches attendance, classwork and results through Classes, and fees
  // through a student's record, so these four are not in the Principal's menu. The pages still open by address.
  // Phase 5, slice 1: student attendance. The Class Teacher marks it; the Co-ordinator and the Admin look (D-069).
  { id: "attendance", labelKey: "nav.attendance", href: "/portal/attendance", roles: ["teacher", "coordinator", "super_admin"], module: "attendance", icon: "attendance" },
  // Phase 5, slice 3: the daily activity log; notes and homework join it in slice 4 (D-071).
  { id: "classwork", labelKey: "nav.classwork", href: "/portal/classwork", roles: ["teacher", "student", "coordinator", "super_admin"], icon: "classwork" },
  // Phase 6: fees. The Accountant works here, the Admin looks, a student sees their own; never the Co-ordinator (D-078).
  { id: "fees", labelKey: "nav.fees", href: "/portal/fees", roles: ["accountant", "super_admin", "student"], module: "fees", icon: "fees" },
  // Phase 7: results. The teacher enters marks, the Co-ordinator verifies and publishes, a student sees their own, the Admin reads (D-082).
  { id: "results", labelKey: "nav.results", href: "/portal/results", roles: ["teacher", "student", "coordinator", "super_admin"], module: "results", icon: "results" },
  // D-091: everything the Principal reads but does not change, in one place. The Co-ordinator holds the student and
  // results reports too (reports.students, reports.results), so she has the entry; the hub lists only her pages (Co-ordinator FUT F-10).
  { id: "reports", labelKey: "nav.reports", href: "/portal/reports", roles: ["admin", "coordinator", "super_admin"], rarely: true, icon: "reports" },
  // D-091: your own profile, password and sign out; for everyone.
  { id: "settings", labelKey: "nav.settings", href: "/portal/settings", rarely: true, icon: "settings" },
];

/** Where the phone's "More" tab goes: a list of the entries that did not fit in the tab bar. */
export const MORE_HREF = "/portal/more";

/**
 * The phone's tab bar and its "More" list. Up to `MAX_TABS` entries are all tabs. Past that, the last tab
 * becomes More: the daily entries fill the other tabs in menu order, and the `rarely` ones (then any
 * daily ones still left over) go into More, also in menu order.
 */
export function splitNav(menu: readonly NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  if (menu.length <= MAX_TABS) return { tabs: [...menu], more: [] };
  const room = MAX_TABS - 1;
  const daily = menu.filter((item) => !item.rarely);
  const tabIds = new Set(daily.slice(0, room).map((item) => item.id));
  if (tabIds.size < room) for (const item of menu) if (tabIds.size < room) tabIds.add(item.id);
  return { tabs: menu.filter((item) => tabIds.has(item.id)), more: menu.filter((item) => !tabIds.has(item.id)) };
}

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
