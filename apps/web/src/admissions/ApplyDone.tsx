"use client";

import { useEffect, useRef } from "react";

import { t } from "@/i18n/messages";
import setupStyles from "@/setup/setup.module.css";
import { Card } from "@/ui";

/**
 * What the visitor sees once the application is sent. It takes focus and is announced, because the form it replaces had
 * the focus (so it would otherwise fall to the top of the page) and, on a long page, the new card could be out of sight.
 * Inside a longer page its heading is an h2, so the page keeps its one h1.
 */
export function ApplyDone({ embedded = false, needsEmail, email }: { embedded?: boolean; needsEmail: boolean; email: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.focus({ preventScroll: true });
  }, []);

  const Heading = embedded ? "h2" : "h1";
  return (
    <Card>
      <div ref={ref} role="status" tabIndex={-1}>
        <Heading className={setupStyles.title}>{t("admissions.apply.doneTitle")}</Heading>
        <p>{needsEmail ? t("admissions.apply.doneBody", { email }) : t("admissions.apply.doneBodyNoEmail")}</p>
      </div>
    </Card>
  );
}
