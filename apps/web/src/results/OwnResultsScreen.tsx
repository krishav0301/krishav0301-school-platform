"use client";

import { Award, BookOpen, CircleAlert, CircleCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, Segments, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { gateFailure, loadCard, loadOwnResults, loadTop20, requestRecheck } from "./client";
import { sentText } from "./MarkSheetScreen";
import { RECHECK_LABEL, className, formatMarks, hundredthsText, scoreText, type MarksCard, type OwnResults, type Top20 } from "./model";
import styles from "./results.module.css";

type Result = OwnResults["results"][number];

/** One result at a glance: the GPA or percentage, the result in words, the subjects passed. Pure. */
export function resultFigures(r: Result): Figure[] {
  const b = r.card.body;
  const neb = b.policy === "neb_gpa";
  const passed = b.subjects.filter((s) => s.passed).length;
  return [
    { key: "score", icon: Award, tone: "accent", value: scoreText(b) ?? b.outcome, label: t(neb ? "results.card.gpaLabel" : "results.card.percentLabel") },
    { key: "result", icon: b.passed ? CircleCheck : CircleAlert, tone: b.passed ? "ok" : "bad", value: neb ? t(b.passed ? "results.card.gpa" : "results.own.ng") : b.outcome, label: t("results.card.result") },
    { key: "subjects", icon: BookOpen, tone: passed < b.subjects.length ? "warn" : "ok", value: t("coord.ofTotal", { done: passed, total: b.subjects.length }), label: t("results.own.figure.passed") },
  ];
}

/** Each subject with its grade (or percentage) and passed or not, in words. Pure. */
export function SubjectsTable({ result }: { result: Result }) {
  const b = result.card.body;
  const neb = b.policy === "neb_gpa";
  return (
    <ReadTable
      caption={t("results.card.subjects")}
      rows={b.subjects}
      rowKey={(s) => s.offeringId}
      columns={[
        { key: "subject", label: t("results.mine.subject"), primary: true, cell: (s) => s.name },
        { key: "grade", label: t(neb ? "results.own.grade" : "results.own.percent"), align: "end", cell: (s) => <span className={readStyles.number}>{neb ? s.grade : `${hundredthsText(s.percentHundredths)}%`}</span> },
        { key: "status", label: t("attendance.class.status"), cell: (s) => (s.passed ? <StatusWord tone="ok">{t("results.own.passed")}</StatusWord> : <StatusWord tone="bad">{neb ? t("results.own.ng") : t("results.card.failed")}</StatusWord>) },
      ]}
    />
  );
}

/** The student's own results (source 6.1; redesigned in D-107): one terminal at a time, the subjects, the marks card, and rechecks. */
export function OwnResultsScreen() {
  const { api } = useSession();
  const { moduleEnabled } = useConfig();
  const loadNow = useCallback(async () => {
    const result = await loadOwnResults(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<OwnResults>(loadNow);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const own = view.status === "ready" ? view.data : null;
  const result = own ? (own.results.find((r) => r.publicationId === picked) ?? own.results[0]) : undefined;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("results.own.title")}
        subtitle={result ? t("results.own.heading", { terminal: result.terminalName, year: result.yearLabel }) : undefined}
        actions={moduleEnabled("top20") ? <OpenLink href="/portal/results/top20" label={t("results.own.top20")} text={t("results.own.top20")} /> : null}
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {own && own.results.length === 0 ? (
        <Panel>
          <EmptyLine>{t("results.own.none")}</EmptyLine>
        </Panel>
      ) : null}
      {own && result ? (
        <>
          {own.results.length > 1 ? (
            <Segments
              label={t("results.own.which")}
              value={result.publicationId}
              options={own.results.map((r) => ({ key: r.publicationId, label: t("results.own.heading", { terminal: r.terminalName, year: r.yearLabel }) }))}
              onChange={(key) => {
                setPicked(key);
                setSent(null);
              }}
            />
          ) : null}
          <FigureTiles figures={resultFigures(result)} label={t("results.own.figures")} />
          {result.card.version > 1 ? <Notice>{t("results.own.corrected", { reason: result.card.reason ?? "" })}</Notice> : null}
          {sent ? <Notice tone="ok">{sent}</Notice> : null}
          <Panel title={t("results.card.subjects")} labelledBy="own-subjects" actions={<OpenLink href={`/portal/results/card?id=${result.card.id}`} label={t("results.own.openCard")} text={t("results.own.card")} />}>
            <SubjectsTable result={result} />
          </Panel>
          <Panel
            title={t("results.own.rechecks")}
            labelledBy="own-rechecks"
            actions={
              <AddDialog label={t("results.own.recheck")} title={t("results.own.recheck")} variant="secondary" plus={false}>
                {(close) => (
                  <RecheckForm
                    result={result}
                    onSent={() => {
                      close();
                      setSent(t("results.own.recheckSent"));
                      void reload();
                    }}
                  />
                )}
              </AddDialog>
            }
          >
            {result.rechecks.length === 0 ? (
              <EmptyLine>{t("results.own.noRechecks")}</EmptyLine>
            ) : (
              <ul className={readStyles.rows}>
                {result.rechecks.map((c) => (
                  <li key={c.id} className={readStyles.rowItem}>
                    <div className={readStyles.rowHead}>
                      <h3 className={readStyles.rowTitle}>{c.subjectName}</h3>
                      <StatusWord tone={c.status === "changed" ? "ok" : c.status === "open" ? "warn" : undefined}>{t(RECHECK_LABEL[c.status])}</StatusWord>
                    </div>
                    <p className={readStyles.rowMeta}>{t("results.rechecks.asked", { reason: c.reason })}</p>
                    {c.decisionReason ? <p>{c.decisionReason}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function RecheckForm({ result, onSent }: { result: Result; onSent: () => void }) {
  const { api } = useSession();
  const open = new Set(result.rechecks.filter((c) => c.status === "open").map((c) => c.offeringId));
  const choices = result.card.body.subjects.filter((s) => !open.has(s.offeringId));
  const [subject, setSubject] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (choices.length === 0) return <p className={styles.meta}>{t("results.own.allAsked")}</p>;

  async function send() {
    setBusy(true);
    const sent = await requestRecheck(api, result.publicationId, subject || choices[0]!.offeringId, reason.trim());
    setBusy(false);
    if (sent.ok) onSent();
    else setError(sentText(sent));
  }

  return (
    <div className={styles.form}>
      <Select label={t("results.own.recheckSubject")} value={subject || choices[0]!.offeringId} onChange={(event) => setSubject(event.target.value)} options={choices.map((s) => ({ value: s.offeringId, label: s.name }))} />
      <Field label={t("results.own.recheckReason")} hint={t("results.own.recheckHint")} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth disabled={reason.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void send()}>
        {t("results.own.recheckSend")}
      </Button>
    </div>
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
                    {!s.passed ? <StatusWord tone="bad">{neb ? t("results.own.ng") : t("results.card.failed")}</StatusWord> : null}
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
