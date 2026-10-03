"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Badge, Field, Notice } from "@/ui";

import styles from "./admissions.module.css";
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
    <>
      <h1 className={setupStyles.title}>{t("admissions.search.title")}</h1>
      <Field label={t("admissions.search.label")} hint={t("admissions.search.hint")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {failure ? <Notice tone="bad">{failure}</Notice> : null}
      {results !== null ? (
        results.length === 0 ? (
          <p className={setupStyles.empty}>{t("admissions.search.empty")}</p>
        ) : (
          <ul className={setupStyles.list}>
            {results.map((s) => (
              <li key={s.id} className={setupStyles.item}>
                <div className={styles.queueItem}>
                  <h2 className={setupStyles.itemTitle}>
                    {/* The whole record, read only (admin FUT F-09). */}
                    <Link href={`/portal/admissions/student?id=${s.id}`}>
                      {s.firstName} {s.lastName}
                    </Link>
                  </h2>
                  <div className={styles.queueMeta}>
                    <Badge>{s.sid}</Badge>
                    {s.className ? <span>{s.className}</span> : null}
                    {s.status !== "active" ? <Badge tone="bad">{t(s.status === "left" ? "admissions.student.left" : "admissions.student.graduated")}</Badge> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
