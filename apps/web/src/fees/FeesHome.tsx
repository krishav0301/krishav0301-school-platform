"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { searchStudents } from "@/admissions/client";
import type { StudentSummary } from "@/admissions/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Badge, Field, Notice } from "@/ui";

import { OwnFees } from "./OwnFees";

/** Fees (D-078): a student sees their own account; staff find a student to open theirs. */
export function FeesHome() {
  const { me } = useSession();
  const student = me?.roles.some((r) => r.role === "student") ?? false;
  return student ? <OwnFees /> : <StudentFinder />;
}

function StudentFinder() {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

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
    <>
      <h1 className={setupStyles.title}>{t("fees.search.title")}</h1>
      <Field label={t("fees.search.label")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {failed ? <Notice tone="bad">{t("fees.failed")}</Notice> : null}
      {results === null ? null : results.length === 0 ? (
        <p className={setupStyles.empty}>{t("fees.search.empty")}</p>
      ) : (
        <ul className={setupStyles.list}>
          {results.map((s) => (
            <li key={s.id} className={setupStyles.item}>
              <h2 className={setupStyles.itemTitle}>
                <Link href={`/portal/fees/student?id=${s.id}`}>
                  {s.firstName} {s.lastName}
                </Link>
              </h2>
              <div className={setupStyles.badges}>
                <Badge>{s.sid}</Badge>
                {s.className ? <span>{s.className}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
