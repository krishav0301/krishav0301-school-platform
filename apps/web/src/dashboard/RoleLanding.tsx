"use client";

import { useEffect, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Illustration, OVERVIEW_ART } from "@/ui";

import { bsLong, greetingKey } from "./admin-model";
import { nepalToday } from "./nepal-today";
import styles from "./landing.module.css";

/**
 * The first page of the Co-ordinator, the Teacher and the Student (the PM, 2026-10-17): one hero with a picture, the
 * greeting, the school and the day, like the landing of a sign-on. There is no Overview in their menu; they start work
 * from the menu beside it. The Principal keeps the dashboard (D-088) and the Accountant their fees day (D-107).
 */
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
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={styles.text}>
        <p className={styles.school}>{config?.school.name}</p>
        <h1 id="landing-title" className={styles.title}>
          {t(greetingKey(now), { name: me.name })}
        </h1>
        <p className={styles.role}>
          {term(`role.${role}`)}
          {dayBs ? <span className={styles.day}>{bsLong(dayBs)}</span> : null}
        </p>
        <p className={styles.hint}>{t("landing.hint")}</p>
      </div>
      <div className={styles.picture} aria-hidden>
        <Illustration code={OVERVIEW_ART[role]} className={styles.art} />
      </div>
    </section>
  );
}
