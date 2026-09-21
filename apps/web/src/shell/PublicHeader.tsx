"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Skeleton, buttonClass } from "@/ui";

import { SITE_LINKS, isHere } from "./site-links";
import styles from "./shell.module.css";

/**
 * The public header, drawn from its state so every case can be checked without a browser. It has two rows,
 * so what is read first is also what is tabbed to first: the school's name, Menu (a phone only) and Sign in;
 * then the page links. Below 48 rem the links are hidden until Menu is pressed; from 48 rem they are always
 * shown. Sign in is quiet on purpose, so a page's own main action stays the only prominent button.
 */
export function PublicHeaderView({
  brand,
  signedIn,
  showSignIn,
  pathname,
  open,
  panelId,
  buttonRef,
  onToggle,
  onNavigate,
}: {
  brand: ReactNode;
  signedIn: boolean;
  showSignIn: boolean;
  pathname: string | null;
  open: boolean;
  panelId: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          {brand}
        </Link>
        <div className={styles.actions}>
          <span className={styles.menuSlot}>
            <button type="button" ref={buttonRef} className={buttonClass({ variant: "quiet" })} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
              {t("site.menu")}
            </button>
          </span>
          {signedIn ? (
            <Link href="/portal" className={buttonClass({ variant: "secondary" })}>
              {t("nav.dashboard")}
            </Link>
          ) : showSignIn ? (
            <Link href="/sign-in" className={buttonClass({ variant: "quiet" })}>
              {t("shell.signIn")}
            </Link>
          ) : null}
        </div>
      </div>
      <nav id={panelId} aria-label={t("site.navLabel")} className={styles.siteNav} data-open={open}>
        <ul className={styles.siteLinks}>
          {SITE_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={styles.siteLink} aria-current={isHere(pathname, link.href) ? "page" : undefined} onClick={onNavigate}>
                {t(link.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Holds whether the Menu is open. It is open only on the page it was opened on, so choosing a link (or any
 * change of page) closes it without an effect. Escape closes it and returns focus to the button.
 */
export function PublicHeader({ showSignIn }: { showSignIn: boolean }) {
  const { config } = useConfig();
  const { status } = useSession();
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const page = pathname ?? "";
  const open = openAt === page;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <PublicHeaderView
      brand={config?.school.shortName ?? <Skeleton width="7rem" />}
      signedIn={status === "signedIn"}
      showSignIn={showSignIn}
      pathname={pathname}
      open={open}
      panelId={panelId}
      buttonRef={buttonRef}
      onToggle={() => setOpenAt(open ? null : page)}
      onNavigate={() => setOpenAt(null)}
    />
  );
}
