"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ApplyScreen } from "@/admissions/ApplyScreen";
import { loadOpenLevels } from "@/admissions/client";
import type { OpenLevel } from "@/admissions/model";
import { contactHref } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { useReveal } from "@/site/scroll/useReveal";
import { Notice, Skeleton } from "@/ui";

import { AccentHeading } from "./parts";
import styles from "./immersive.module.css";

export type AdmissionState = "loading" | "open" | "closed";

/**
 * The admission section in each state, drawn from it so every state can be checked without a network. With a class open it
 * holds the form; otherwise (none open, or the list could not be loaded) it says so and gives the office's phone number, so
 * nobody meets a form that cannot work.
 */
export function AdmissionView({ state, phone, form }: { state: AdmissionState; phone: string | null; form: ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  const href = phone ? contactHref(phone) : null;
  return (
    <div ref={ref} className={styles.reveal}>
      <div className={styles.center}>
        <AccentHeading text={t("immersive.admission.title")} />
        {state === "open" ? <p className={styles.lead}>{t("immersive.admission.lead")}</p> : null}
      </div>
      {state === "loading" ? (
        <div role="status" aria-busy="true" className={styles.formShape}>
          <span className="sr-only">{t("setup.loading")}</span>
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </div>
      ) : null}
      {state === "open" ? <div className={styles.formWrap}>{form}</div> : null}
      {state === "closed" ? (
        <div className={styles.formWrap}>
          <Notice title={t("immersive.admission.closedTitle")}>
            <p>{t("immersive.admission.closedBody")}</p>
            {phone ? <p>{href ? <a href={href}>{phone}</a> : phone}</p> : null}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

/** Looks for classes open for admission, then shows the form with them, or the office's number. */
export function Admission({ phone }: { phone: string | null }) {
  const { api } = useSession();
  const [levels, setLevels] = useState<OpenLevel[] | null | undefined>(undefined); // undefined: loading; null: could not load

  useEffect(() => {
    let active = true;
    void loadOpenLevels(api).then((result) => {
      if (active) setLevels(result.ok ? result.data : null);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const state: AdmissionState = levels === undefined ? "loading" : levels && levels.length > 0 ? "open" : "closed";
  return <AdmissionView state={state} phone={phone} form={levels && levels.length > 0 ? <ApplyScreen embedded levels={levels} /> : null} />;
}
