"use client";

import { Files } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui";

import { loadClassGradeSheets } from "./client";
import styles from "./documents.module.css";
import { downloadSheetsAsPdf, fileSafe } from "./download-pdf";
import { GradeSheetDocument } from "./GradeSheetDocument";
import type { GradeSheet } from "./model";

/** What the button's label says: what it does, or how far it has got. Pure. */
export function classCardsLabel(state: { making: { done: number; total: number } | null; fetching: boolean }): string {
  if (state.making) return t("results.doc.makingCards", state.making);
  return state.fetching ? t("results.doc.fetchingCards") : t("results.doc.downloadClassCards");
}

/**
 * "Download all marks cards": every student's GRADE-SHEET of a class for one exam (or the final, `terminalId` null) as one A4
 * PDF, a sheet each (the PM, 2026-11-23, D-195), on the class sheet beside the mark ledger (the PM: "next to the mark ledger,
 * not inside it", D-197). The cards are fetched only when asked, drawn out of sight, pictured one at a time, then let go. The
 * label itself says how far it has got, and a hidden status says it once more for a screen reader.
 */
export function ClassCardsButton({ classId, terminalId, className }: { classId: string; terminalId: string | null; className?: string }) {
  const { api } = useSession();
  const stage = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<GradeSheet[] | null>(null);
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const got = await loadClassGradeSheets(api, classId, terminalId);
      if (!got.ok) throw new Error(got.reason);
      const first = got.data.sheets[0];
      flushSync(() => {
        setCards(got.data.sheets);
        setMaking({ done: 0, total: got.data.sheets.length });
      });
      const nodes = [...(stage.current?.children ?? [])] as HTMLElement[];
      await Promise.all(nodes.flatMap((n) => [...n.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined))));
      const name = first ? fileSafe("Marks cards", first.className, first.examName ?? "final", first.yearLabel) : fileSafe("Marks cards");
      await downloadSheetsAsPdf(nodes, name, styles.capture, (done, total) => setMaking({ done, total }));
    } catch {
      setFailed(true);
    }
    setCards(null);
    setMaking(null);
    setBusy(false);
  }
  const label = classCardsLabel({ making, fetching: busy });
  return (
    <>
      <Button variant="secondary" className={className} disabled={busy} aria-busy={busy || undefined} onClick={() => void download()}>
        <Files aria-hidden width={18} height={18} />
        {label}
      </Button>
      <span className="sr-only" role="status">
        {busy ? label : failed ? t("results.doc.downloadFailed") : ""}
      </span>
      {failed ? (
        <span className={styles.progress} aria-hidden>
          {t("results.doc.downloadFailed")}
        </span>
      ) : null}
      {cards ? (
        <div ref={stage} className={styles.offstage} aria-hidden>
          {cards.map((sheet) => (
            <div key={sheet.cardId}>
              <GradeSheetDocument sheet={sheet} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
