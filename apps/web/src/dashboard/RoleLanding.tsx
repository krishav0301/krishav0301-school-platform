"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ReadHeader, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { NAV_ICONS } from "@/shell/icons";
import { NAV_ITEMS, visibleNav, type NavItem } from "@/shell/nav";
import { OVERVIEW_ART } from "@/ui";

import { bsLong, greetingKey } from "./admin-model";
import { nepalToday } from "./nepal-today";
import styles from "./landing.module.css";

/**
 * The landing page of the Co-ordinator, the Teacher and the Student (the PM, 2026-10-17): what you reach after signing in
 * is a hero and the places you can go, with no figures, lists or charts. The places are the ones the menu holds for the
 * person's roles in this school (so a switched-off module is not there), each a large tile. The Principal keeps the
 * dashboard (D-088).
 */
export function landingPlaces<R extends { role: string }>(roles: readonly R[], modules: Readonly<Record<string, boolean>>): NavItem[] {
  return visibleNav(NAV_ITEMS, roles, modules).filter((item) => item.id !== "dashboard");
}

export function RoleLanding({ role }: { role: keyof typeof OVERVIEW_ART }) {
  const { api, me } = useSession();
  const { config, term } = useConfig();
  const [now] = useState(() => new Date());
  const [dayBs, setDayBs] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void nepalToday(api).then((day) => active && setDayBs(day));
    return () => {
      active = false;
    };
  }, [api]);
  if (!me) return null;
  const places = landingPlaces(me.roles, config?.modules ?? {});
  return (
    <div className={readStyles.page}>
      <ReadHeader art={OVERVIEW_ART[role]} title={t(greetingKey(now), { name: me.name })} subtitle={t("landing.subtitle", { role: term(`role.${role}`), school: config?.school.shortName ?? "" })} dayBs={dayBs ? bsLong(dayBs) : null} />
      <ul className={styles.places} aria-label={t("landing.places")}>
        {places.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.id}>
              <Link href={item.opensAt ?? item.href} className={styles.place}>
                <span className={styles.placeIcon} aria-hidden>
                  <Icon strokeWidth={1.75} />
                </span>
                <span className={styles.placeName}>{t(item.labelKey)}</span>
                <ChevronRight aria-hidden className={styles.placeArrow} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
