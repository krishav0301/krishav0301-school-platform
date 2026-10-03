"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadTable, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, Select } from "@/ui";

import { gateFailure, loadCard, loadOwnResults, loadTop20, requestRecheck } from "./client";
import { sentText } from "./MarkSheetScreen";
import { RECHECK_LABEL, className, formatMarks, hundredthsText, scoreText, type MarksCard, type OwnResults, type Top20 } from "./model";
import styles from "./results.module.css";

/** The student's own results by year and terminal (source 6.1): nothing until published, then the card and rechecks. */
export function OwnResultsScreen() {
  const { api } = useSession();
  const { moduleEnabled } = useConfig();
  const loadNow = useCallback(async () => {
    const result = await loadOwnResults(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<OwnResults>(loadNow);
  return (
    <>
      <h1 className={setupStyles.title}>{t("results.own.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(own) =>
          own.results.length === 0 ? (
            <p className={setupStyles.empty}>{t("results.own.none")}</p>
          ) : (
            <ul className={setupStyles.list}>
              {own.results.map((r) => (
                <li key={r.publicationId} className={setupStyles.item}>
                  <h2 className={setupStyles.itemTitle}>
                    {t("results.own.heading", {
                      terminal: r.terminalName,
                      year: r.yearLabel,
                    })}
                  </h2>
                  <p className={styles.score}>{scoreText(r.card.body) ?? r.card.body.outcome}</p>
                  <p className={styles.meta}>{r.card.body.policy === "neb_gpa" ? t(r.card.body.passed ? "results.card.gpa" : "results.card.notGraded") : r.card.body.outcome}</p>
                  <ul className={styles.list}>
                    {r.card.body.subjects.map((s) => (
                      <li key={s.offeringId} className={styles.row}>
                        <span>{s.name}</span>
                        <span className={styles.state}>
                          <Badge tone={s.passed ? undefined : "bad"}>{s.grade}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {r.card.version > 1 ? (
                    <Notice>
                      {t("results.own.corrected", {
                        reason: r.card.reason ?? "",
                      })}
                    </Notice>
                  ) : null}
                  {r.rechecks.map((c) => (
                    <p key={c.id} className={styles.meta}>
                      {t("results.own.recheckLine", {
                        subject: c.subjectName,
                        status: t(RECHECK_LABEL[c.status]),
                      })}
                      {c.decisionReason ? ` ${c.decisionReason}` : ""}
                    </p>
                  ))}
                  <Link href={`/portal/results/card?id=${r.card.id}`}>{t("results.own.openCard")}</Link>
                  <RecheckForm result={r} onSent={() => void reload()} />
                </li>
              ))}
            </ul>
          )
        }
      </Gate>
      {moduleEnabled("top20") ? (
        <p>
          <Link href="/portal/results/top20">{t("results.own.top20")}</Link>
        </p>
      ) : null}
    </>
  );
}

function RecheckForm({ result, onSent }: { result: OwnResults["results"][number]; onSent: () => void }) {
  const { api } = useSession();
  const open = new Set(result.rechecks.filter((c) => c.status === "open").map((c) => c.offeringId));
  const choices = result.card.body.subjects.filter((s) => !open.has(s.offeringId));
  const [asking, setAsking] = useState(false);
  const [subject, setSubject] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  if (choices.length === 0) return null;

  async function send() {
    setBusy(true);
    const sent = await requestRecheck(api, result.publicationId, subject || choices[0]!.offeringId, reason.trim());
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: t("results.own.recheckSent") });
      setAsking(false);
      setReason("");
      onSent();
    } else setMessage({ tone: "bad", text: sentText(sent)! });
  }

  return (
    <>
      {asking ? (
        <div className={styles.card}>
          <Select
            label={t("results.own.recheckSubject")}
            value={subject || choices[0]!.offeringId}
            onChange={(event) => setSubject(event.target.value)}
            options={choices.map((s) => ({
              value: s.offeringId,
              label: s.name,
            }))}
          />
          <Field label={t("results.own.recheckReason")} hint={t("results.own.recheckHint")} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          <div className={styles.actions}>
            <Button className={styles.wrapLabel} variant="secondary" disabled={reason.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void send()}>
              {t("results.own.recheckSend")}
            </Button>
            <Button className={styles.wrapLabel} variant="quiet" onClick={() => setAsking(false)}>
              {t("results.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => setAsking(true)}>
            {t("results.own.recheck")}
          </Button>
        </div>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </>
  );
}

/** A marks card (`?id=`): the snapshot kept at publish or at a recheck, printable. A student finds their own; staff by id. */
export function MarksCardScreen() {
  const { api, me } = useSession();
  const { config } = useConfig();
  const search = useAddressQuery();
  const id = useMemo(() => new URLSearchParams(search ?? "").get("id") ?? "", [search]);
  const student = me?.roles.some((r) => r.role === "student") ?? false;
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    if (student) {
      const own = await loadOwnResults(api);
      if (!own.ok) return gateFailure(own.reason);
      const card = own.data.results.find((r) => r.card.id === id)?.card;
      return card ? { ok: true as const, data: card } : gateFailure("not_found");
    }
    const result = await loadCard(api, id);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id, student]);
  const { view, reload } = useLoad<MarksCard>(loadNow);

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(card) => {
        const b = card.body;
        const neb = b.policy === "neb_gpa";
        return (
          <article className={`${styles.card} ${styles.document}`} aria-labelledby="card-heading">
            <div>
              <p className={styles.meta}>{config?.school.name}</p>
              <h1 id="card-heading" className={setupStyles.title}>
                {t("results.card.title", { terminal: b.terminal.name })}
              </h1>
            </div>
            <dl>
              <dt>{t("results.card.student")}</dt>
              <dd>
                {b.student.name} ({b.student.sid})
              </dd>
              <dt>{t("results.card.class")}</dt>
              <dd>
                {className(b.class)} · {b.class.yearLabel}
              </dd>
              <dt>{t(neb ? "results.card.gpaLabel" : "results.card.percentLabel")}</dt>
              <dd className={styles.score}>{scoreText(b) ?? "–"}</dd>
              <dt>{t("results.card.result")}</dt>
              <dd>{neb ? t(b.passed ? "results.card.gpa" : "results.card.notGraded") : b.outcome}</dd>
            </dl>
            <ul className={styles.list} aria-label={t("results.card.subjects")}>
              {b.subjects.map((s) => (
                <li key={s.offeringId} className={styles.row}>
                  <span>
                    {s.name}
                    <br />
                    <span className={styles.meta}>
                      {s.components
                        .map((c) =>
                          t("results.card.component", {
                            name: c.name,
                            mark: c.absent ? "AB" : c.valueHundredths === null ? "–" : formatMarks(c.valueHundredths),
                            max: formatMarks(c.maxHundredths),
                          }),
                        )
                        .join(" · ")}
                    </span>
                  </span>
                  <span className={styles.state}>
                    <span className={styles.number}>{neb ? s.grade : `${hundredthsText(s.percentHundredths)}%`}</span>
                    {!s.passed ? <Badge tone="bad">{neb ? "NG" : t("results.card.failed")}</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.meta}>
              {t("results.card.published", {
                date: card.publishedAtBs ?? card.publishedAt.slice(0, 10),
              })}
              {card.version > 1 ? ` ${t("results.card.version", { version: card.version, reason: card.reason ?? "" })}` : ""}
            </p>
            <div className={`${styles.actions} ${styles.noPrint}`}>
              <Button className={styles.wrapLabel} variant="secondary" onClick={() => window.print()}>
                {t("results.card.print")}
              </Button>
            </div>
          </article>
        );
      }}
    </Gate>
  );
}

/** One Top 20 list: rank and name, with class (and score) only when the server gives them to this reader. Pure. */
export function Top20Table({ entries }: { entries: Top20["pools"][number]["entries"] }) {
  const withClass = entries.some((e) => e.className !== undefined);
  return (
    <ReadTable
      caption={t("results.top20.title")}
      rows={entries}
      rowKey={(e) => `${e.rank}-${e.name}`}
      columns={[
        { key: "rank", label: t("results.sheets.rank"), cell: (e) => <span className={readStyles.number}>{e.rank}</span> },
        { key: "name", label: t("results.grid.student"), primary: true, cell: (e) => e.name },
        ...(withClass ? [{ key: "class", label: t("attendance.col.class"), cell: (e: Top20["pools"][number]["entries"][number]) => e.className ?? "—" }] : []),
      ]}
    />
  );
}

/** The Top 20 (CLAUDE.md section 6, redesigned in D-104): per section and level, only from published results; ties share a rank. */
export function Top20Screen() {
  const { api } = useSession();
  const [terminalId, setTerminalId] = useState<string | undefined>(undefined);
  const loadNow = useCallback(async () => {
    const result = await loadTop20(api, terminalId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, terminalId]);
  const { view, reload } = useLoad<Top20>(loadNow);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.top20.title")} subtitle={t("results.top20.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={8} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          {view.data.terminals.length > 1 ? (
            <div className={readStyles.search}>
              <Select label={t("results.terminal")} value={view.data.terminalId ?? ""} onChange={(event) => setTerminalId(event.target.value)} options={view.data.terminals.map((x) => ({ value: x.id, label: x.name }))} />
            </div>
          ) : null}
          {view.data.pools.length === 0 ? (
            <EmptyLine>{t("results.top20.none")}</EmptyLine>
          ) : (
            view.data.pools.map((pool, i) => (
              <Panel key={`${pool.sectionName}-${pool.levelName}`} title={t("results.top20.pool", { section: pool.sectionName, level: pool.levelName })} labelledBy={`top20-${i}`}>
                <Top20Table entries={pool.entries} />
              </Panel>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}
