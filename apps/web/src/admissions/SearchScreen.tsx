"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Badge, Field, Notice } from "@/ui";

import styles from "./admissions.module.css";
import { searchStudents } from "./client";
import type { StudentSummary } from "./model";

/** By name, SID or phone, scoped to the person's sections (D-063). */
export function SearchScreen() {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = useCallback(
    async (q: string) => {
      if (!q.trim()) return setResults(null);
      const result = await searchStudents(api, q.trim());
      if (result.ok) {
        setFailure(null);
        setResults(result.data);
      } else {
        setFailure(t("admissions.error.failed"));
      }
    },
    [api],
  );

  return (
    <>
      <h1 className={setupStyles.title}>{t("admissions.search.title")}</h1>
      <Field
        label={t("admissions.search.label")}
        hint={t("admissions.search.hint")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          void run(event.target.value);
        }}
      />
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
                    {s.firstName} {s.lastName}
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
