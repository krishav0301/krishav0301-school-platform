"use client";

import { ResultsLayout } from "@/results/ResultsTabs";
import { MarkLedgerScreen } from "@/results/MarkLedgerDocument";

/** A class's mark ledger, printable (?class=&exam=). */
export default function MarkLedgerPage() {
  return (
    <ResultsLayout>
      <MarkLedgerScreen />
    </ResultsLayout>
  );
}
