"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, readStyles } from "@/read/ReadView";
import { Field } from "@/ui";

import { searchStudents } from "./client";
import type { StudentSummary } from "./model";

/** How long to wait, after the last keystroke, before searching. Keeps a fast typer from firing a request per letter. */
const DEBOUNCE_MS = 300;

/** By name, SID or phone, scoped to the person's sections (D-063). */
export function SearchScreen() {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useRef(0);

  const run = useCallback(
    async (q: string) => {
      const mine = ++latest.current;
      if (!q.trim()) return setResults(null);
      const result = await searchStudents(api, q.trim());
      if (mine !== latest.current) return; // a newer search has since started; drop this stale answer
      if (result.ok) {
        setFailure(null);
        setResults(result.data);
      } else {
        setFailure(t("admissions.error.failed"));
      }
    },
    [api],
  );

  useEffect(() => {
    const id = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, run]);

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("admissions.search.title")} subtitle={t("admissions.search.subtitle")} />
      <div className={readStyles.search}>
        <Field label={t("admissions.search.label")} hint={t("admissions.search.hint")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {failure ? <ReadFailure status="failed" onRetry={() => void run(query)} /> : null}
      {results !== null ? (
        results.length === 0 ? (
          <EmptyLine>{t("admissions.search.empty")}</EmptyLine>
        ) : (
          <Panel>
            <StudentsTable students={results} />
          </Panel>
        )
      ) : null}
    </div>
  );
}

/** The students found: the name opens the record (admin FUT F-09); Left or Graduated said in words. Pure. */
export function StudentsTable({ students }: { students: readonly StudentSummary[] }) {
  return (
    <ReadTable
      caption={t("admissions.search.results")}
      rows={students}
      rowKey={(s) => s.id}
      columns={[
        {
          key: "name",
          label: t("fees.col.student"),
          primary: true,
          cell: (s) => (
            <Link href={`/portal/admissions/student?id=${s.id}`}>
              {s.firstName} {s.lastName}
            </Link>
          ),
        },
        { key: "sid", label: t("attendance.col.sid"), cell: (s) => s.sid },
        { key: "class", label: t("attendance.col.class"), cell: (s) => s.className ?? "—" },
        {
          key: "status",
          label: t("attendance.class.status"),
          cell: (s) => (s.status === "active" ? <StatusWord tone="ok">{t("admissions.student.active")}</StatusWord> : <StatusWord>{t(s.status === "left" ? "admissions.student.left" : "admissions.student.graduated")}</StatusWord>),
        },
        { key: "open", label: t("admissions.search.record"), align: "end", plain: true, cell: (s) => <OpenLink href={`/portal/admissions/student?id=${s.id}`} label={t("admissions.search.open", { name: `${s.firstName} ${s.lastName}` })} /> },
      ]}
    />
  );
}
