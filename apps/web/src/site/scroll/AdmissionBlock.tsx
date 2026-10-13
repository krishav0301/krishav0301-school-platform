"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ApplyScreen } from "@/admissions/ApplyScreen";
import { loadOpenLevels } from "@/admissions/client";
import type { OpenLevel } from "@/admissions/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Notice, Skeleton } from "@/ui";

import { Reach } from "@/site/Reach";
import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

export type AdmissionState = "loading" | "open" | "closed";

/**
 * The admission section in each state, drawn from it so every state can be checked without a network. With a class
 * open it holds the form; otherwise (none open, or the list could not be loaded) it says so and gives the office's
 * phone number, so nobody meets a form that cannot work.
 */
export function AdmissionBlockView({ state, phone, form }: { state: AdmissionState; phone: string | null; form: ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={styles.reveal}>
      <h2 className={styles.sectionTitle}>{t("scroll.admission.title")}</h2>
      {state === "open" ? <p className={styles.sectionLead}>{t("scroll.admission.lead")}</p> : null}
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
        <Notice title={t("scroll.admission.closedTitle")}>
          <p>{t("scroll.admission.closedBody")}</p>
          {phone ? (
            <p>
              <Reach value={phone} />
            </p>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}

/** Looks for classes open for admission, then shows the form with them, or the office's number. */
export function AdmissionBlock({ phone }: { phone: string | null }) {
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
  return <AdmissionBlockView state={state} phone={phone} form={levels && levels.length > 0 ? <ApplyScreen embedded levels={levels} /> : null} />;
}
