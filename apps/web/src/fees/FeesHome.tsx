"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { searchStudents } from "@/admissions/client";
import type { StudentSummary } from "@/admissions/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, readStyles } from "@/read/ReadView";
import { Field } from "@/ui";

import { loadDues } from "./client";
import { OwnFees } from "./OwnFees";
import { BalanceWord } from "./ReadFees";

/** Fees (D-078): a student sees their own account; staff find a student to open theirs. */
export function FeesHome() {
  const { me } = useSession();
  const student = me?.roles.some((r) => r.role === "student") ?? false;
  return student ? <OwnFees /> : <StudentFinder />;
}

type Balance = { chargedPaisa: number; paidPaisa: number; duePaisa: number; overduePaisa: number; balancePaisa: number };

/** The students found, each with this year's balance in words when the dues list has them, each opening the account. Pure. */
export function FoundStudents({ students, balances }: { students: readonly StudentSummary[]; balances: ReadonlyMap<string, Balance> | null }) {
  return (
    <ReadTable
      caption={t("fees.search.results")}
      rows={students}
      rowKey={(s) => s.id}
      columns={[
        {
          key: "name",
          label: t("fees.col.student"),
          primary: true,
          cell: (s) => (
            <Link href={`/portal/fees/student?id=${s.id}`}>
              {s.firstName} {s.lastName}
            </Link>
          ),
        },
        { key: "sid", label: t("attendance.col.sid"), cell: (s) => s.sid },
        { key: "class", label: t("attendance.col.class"), cell: (s) => s.className ?? "—" },
        ...(balances
          ? [
              {
                key: "balance",
                label: t("fees.col.balance"),
                cell: (s: StudentSummary) => {
                  const row = balances.get(s.sid);
                  return row ? <BalanceWord row={row} /> : "—";
                },
              },
            ]
          : []),
        { key: "open", label: t("fees.col.account"), align: "end" as const, plain: true, cell: (s) => <OpenLink href={`/portal/fees/student?id=${s.id}`} label={t("fees.openAccount", { name: `${s.firstName} ${s.lastName}` })} /> },
      ]}
    />
  );
}

function StudentFinder() {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [balances, setBalances] = useState<Map<string, Balance> | null>(null);
  const latest = useRef(0);

  // This year's balances come from the dues list once; without them the search still works (D-104).
  useEffect(() => {
    let live = true;
    void loadDues(api).then((dues) => {
      if (live && dues.ok) setBalances(new Map(dues.data.students.map((s) => [s.sid, s])));
    });
    return () => {
      live = false;
    };
  }, [api]);

  const run = useCallback(
    async (q: string) => {
      const mine = ++latest.current;
      if (!q.trim()) return setResults(null);
      const result = await searchStudents(api, q.trim());
      if (mine !== latest.current) return;
      setFailed(!result.ok);
      if (result.ok) setResults(result.data);
    },
    [api],
  );
  useEffect(() => {
    const id = setTimeout(() => void run(query), 300);
    return () => clearTimeout(id);
  }, [query, run]);

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("fees.title")} subtitle={t("fees.search.subtitle")} />
      <div className={readStyles.search}>
        <Field label={t("fees.search.label")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {failed ? <ReadFailure status="failed" onRetry={() => void run(query)} /> : null}
      {results === null ? null : results.length === 0 ? (
        <EmptyLine>{t("fees.search.empty")}</EmptyLine>
      ) : (
        <Panel>
          <FoundStudents students={results} balances={balances} />
        </Panel>
      )}
    </div>
  );
}
