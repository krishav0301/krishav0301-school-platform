"use client";

import { BookOpen, CalendarDays, School, CalendarRange, ChartColumn, ChartPie, ChevronDown, CircleCheck, ClipboardList, CreditCard, Ellipsis, FileText, Globe, House, LogOut, Settings, Settings2, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { APPROVALS_CHANGED } from "@/approvals/client";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { readPalette, showPalette } from "@/theme/personal";
import { Illustration, Skeleton, Spinner } from "@/ui";

import { GlobalSearch } from "./GlobalSearch";
import { MORE_HREF, NAV_ITEMS, isCurrent, showsMenu, splitNav, visibleNav, type NavIcon, type NavItem } from "./nav";
import { TERM_ROLES, TermChoiceProvider, TermPicker } from "./TermChoice";
import styles from "./shell.module.css";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: House,
  classes: School,
  website: Globe,
  programs: BookOpen,
  terms: CalendarRange,
  setup: Settings2,
  people: Users,
  approvals: CircleCheck,
  admissions: ClipboardList,
  attendance: CalendarDays,
  classwork: FileText,
  fees: CreditCard,
  results: ChartColumn,
  reports: ChartPie,
  settings: Settings,
};

/** "Sita Sharma" → "SS"; one word → its first two letters. */
export const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase();
};

/**
 * How many approval requests wait for this person's decision (their own are not theirs to decide); null until known,
 * or for anyone else. Asked again whenever a decision is made on any screen (admin FUT F-03).
 */
function usePendingApprovals(enabled: boolean): number | null {
  const { api } = useSession();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const ask = () =>
      api
        .GET("/api/approvals")
        .then(({ data }) => {
          if (live && data) setCount(data.requests.filter((r) => !r.mine).length);
        })
        .catch(() => {});
    void ask();
    window.addEventListener(APPROVALS_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(APPROVALS_CHANGED, ask);
    };
  }, [api, enabled]);
  return enabled ? count : null;
}

/**
 * The frame around every signed-in page (D-088, after the PM's reference design): a sidebar with the school's name
 * and the menu, a header with the person's name and their account menu, and the page. The layout is the same for
 * every school (CLAUDE.md rule 6); only colours, fonts, names and wording differ. On a phone the menu is a bottom tab
 * bar, left out while there is only one place to go. Someone who is not signed in is sent to the sign-in page.
 */
export function PortalShell({ children, items = NAV_ITEMS }: { children: ReactNode; items?: readonly NavItem[] }) {
  const { status, me, signOut } = useSession();
  const { config, term } = useConfig();
  const pathname = usePathname();
  const router = useRouter();
  const menu = me ? visibleNav(items, me.roles, config?.modules ?? {}) : [];
  const pending = usePendingApprovals(menu.some((item) => item.id === "approvals"));

  useEffect(() => {
    if (status === "signedOut") router.replace("/sign-in");
  }, [status, router]);

  // The person's own colours (D-127) inside the portal only; leaving it restores the school's.
  useEffect(() => {
    showPalette(readPalette());
    return () => showPalette(null);
  }, []);

  if (status !== "signedIn" || !me) {
    return (
      <div className={styles.frame}>
        <main className={`${styles.main} ${styles.centered}`}>
          <Spinner label={t("portal.checking")} />
          <Skeleton width="12rem" />
        </main>
      </div>
    );
  }

  const hasMenu = showsMenu(menu);
  // On a phone, entries past the tab bar's room are listed under a last "More" tab; the sidebar shows them all.
  const { more } = splitNav(menu);
  const overflow = new Set(more.map((item) => item.id));
  const inMore = pathname === MORE_HREF || more.some((item) => isCurrent(pathname, item.href));
  const primaryRole = me.roles.find((r) => r.role !== "super_admin")?.role;
  const roleWord = primaryRole ? term(`role.${primaryRole}`) : t("portal.support");

  const brand = (
    <Link href="/portal" className={styles.brand}>
      <span className={styles.brandName}>{config?.school.shortName ?? <Skeleton width="7rem" />}</span>
      <span className={styles.brandSub}>{t("shell.brandSubtitle")}</span>
    </Link>
  );

  const choosesTerm = me.roles.some((r) => (TERM_ROLES as readonly string[]).includes(r.role));
  const pages = menu.map((item) => ({ label: t(item.labelKey), href: item.opensAt ?? item.href }));

  return (
    <TermChoiceProvider enabled={choosesTerm}>
    <div className={`${styles.frame} ${hasMenu ? styles.withTabs : ""}`}>
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <div className={styles.headerBrand}>{brand}</div>
          {/* Search and the term picker (D-127), between the school's name and the account. */}
          <div className={styles.tools}>
            <GlobalSearch pages={pages} />
            <TermPicker />
          </div>
          <details className={styles.account}>
            <summary className={styles.accountButton} aria-label={t("shell.account")}>
              <span className={styles.avatar} title={me.name} aria-hidden>
                {initials(me.name)}
              </span>
              <span className={styles.accountText}>
                <span className={styles.accountRole}>{roleWord}</span>
                <span className={styles.accountName}>{config?.school.name}</span>
              </span>
              <ChevronDown aria-hidden className={styles.accountChevron} />
            </summary>
            <div className={styles.accountMenu}>
              <p className={styles.accountWho}>{t("shell.signedInAs", { name: me.name })}</p>
              <Link href="/portal/settings" className={styles.accountItem}>
                <Settings aria-hidden className={styles.navIcon} />
                {t("nav.settings")}
              </Link>
              <button type="button" className={styles.accountItem} onClick={() => void signOut()}>
                <LogOut aria-hidden className={styles.navIcon} />
                {t("shell.signOut")}
              </button>
            </div>
          </details>
        </div>
      </header>
      <div className={styles.body}>
        {hasMenu ? (
          <aside className={styles.sidebar}>
            <div className={styles.sidebarBrand}>{brand}</div>
            <nav className={styles.nav} aria-label={t("shell.mainNavigation")}>
              {menu.map((item) => {
                const Icon = ICONS[item.icon];
                const badge = item.id === "approvals" && pending ? pending : null;
                return (
                  <Link
                    key={item.id}
                    href={item.opensAt ?? item.href}
                    className={[styles.navLink, overflow.has(item.id) ? styles.overflow : ""].filter(Boolean).join(" ")}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  >
                    <Icon aria-hidden className={styles.navIcon} strokeWidth={1.75} />
                    <span className={styles.navLabel}>{t(item.labelKey)}</span>
                    {badge ? <span className={styles.badge}>{badge}</span> : null}
                  </Link>
                );
              })}
              {more.length > 0 ? (
                <Link href={MORE_HREF} className={`${styles.navLink} ${styles.moreLink}`} aria-current={inMore ? "page" : undefined}>
                  <Ellipsis aria-hidden className={styles.navIcon} strokeWidth={1.75} />
                  <span className={styles.navLabel}>{t("nav.more")}</span>
                </Link>
              ) : null}
            </nav>
            {/* Wide screens only: a calm card at the foot of the sidebar, its picture in the corner (D-126). */}
            <div className={styles.sideCard} aria-hidden>
              <p className={styles.sideTitle}>{t("art.sideTitle")}</p>
              <p className={styles.sideBody}>{t("art.sideBody")}</p>
              <Illustration code="S1" size="side" className={styles.sideArt} />
            </div>
          </aside>
        ) : null}
        <main id="main" className={styles.main}>
          <ConfigGate>{children}</ConfigGate>
        </main>
      </div>
    </div>
    </TermChoiceProvider>
  );
}
