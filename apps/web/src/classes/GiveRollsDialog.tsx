"use client";

import { useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Notice } from "@/ui";

import { giveRollNumbers, type GivenRolls } from "./client";
import styles from "./classes.module.css";

/** What to tell the Co-ordinator after the click. Pure. */
export function givenText(result: GivenRolls): string {
  if (result.ok) return t(result.numbered === 1 ? "classes.rolls.doneOne" : "classes.rolls.done", { count: result.numbered });
  return t(result.reason === "nobody_waiting" ? "classes.rolls.nobodyWaiting" : "classes.rolls.failed");
}

/**
 * "Give roll numbers" on a class's Students tab (the PM, 2026-10-29): once the students are in, one click numbers everyone who has
 * no roll number, alphabetically. Shown only while someone is waiting for one. The dialog says what will happen first, since
 * numbers given are never changed.
 */
export function GiveRollsDialog({ classId, waiting, onGiven }: { classId: string; waiting: number; onGiven: (message: string) => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function give(close: () => void) {
    setBusy(true);
    setError(null);
    const result = await giveRollNumbers(api, classId);
    setBusy(false);
    if (result.ok || result.reason === "nobody_waiting") {
      close();
      onGiven(givenText(result));
    } else setError(givenText(result));
  }

  return (
    <AddDialog label={t("classes.rolls.open")} title={t("classes.rolls.title")} variant="secondary" plus={false}>
      {(close) => (
        <div className={styles.rollsForm}>
          <p>{t(waiting === 1 ? "classes.rolls.bodyOne" : "classes.rolls.body", { count: waiting })}</p>
          <p className={styles.importNote}>{t("classes.rolls.later")}</p>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Button fullWidth loading={busy} loadingLabel={t("classes.rolls.giving")} onClick={() => void give(close)}>
            {t("classes.rolls.confirm")}
          </Button>
        </div>
      )}
    </AddDialog>
  );
}
