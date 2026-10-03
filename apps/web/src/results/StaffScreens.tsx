"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { loadClasses, loadTerminals, loadYears } from "@/setup/client";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Checkbox, Field, Notice, Select, buttonClass } from "@/ui";

import { decideRecheck, gateFailure, loadClassSheet, loadElectives, loadRechecks, setPicks } from "./client";
import { sentText } from "./MarkSheetScreen";
import { RECHECK_LABEL, className, hundredthsText, markText, parseMark, scoreText, type ClassElectives, type ClassSheet, type RecheckList } from "./model";
import styles from "./results.module.css";

interface Choices {
  classes: { id: string; name: string }[];
  terminals: { id: string; name: string }[];
}

/** This year's active classes and terminals, for the pickers. */
async function loadChoices(api: Parameters<typeof loadYears>[0]) {
  const years = await loadYears(api);
  if (!years.ok) return gateFailure(years.reason);
  const year = years.data.years.find((y) => y.status === "active");
  if (!year)
    return {
      ok: true as const,
      data: { classes: [], terminals: [] } satisfies Choices,
    };
  const [classes, terminals] = await Promise.all([loadClasses(api, year.id), loadTerminals(api, year.id)]);
  if (!classes.ok) return gateFailure(classes.reason);
  if (!terminals.ok) return gateFailure(terminals.reason);
  return {
    ok: true as const,
    data: {
      classes: classes.data.classes
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          name: className({
            programmeName: c.programmeName,
            levelName: c.levelName,
            label: c.label,
          }),
        })),
      terminals: terminals.data.terminals.map((x) => ({
        id: x.id,
        name: x.name,
      })),
    } satisfies Choices,
  };
}

function useQuery(): URLSearchParams {
  const search = useAddressQuery();
  return useMemo(() => new URLSearchParams(search ?? ""), [search]);
}

/** The whole-class sheet (source 6.3, redesigned in D-104): pick a class and a terminal; a published one shows students by subjects, ranked. */
export function ClassSheetsScreen() {
  const { api } = useSession();
  const query = useQuery();
  const loadNow = useCallback(() => loadChoices(api), [api]);
  const { view, reload } = useLoad<Choices>(loadNow);
  // What the address asked for (a link from the review board), until the person picks something else.
  const [picked, setPicked] = useState<{
    classId?: string;
    terminalId?: string;
  }>({});
  const classId = picked.classId ?? query.get("class") ?? "";
  const terminalId = picked.terminalId ?? query.get("terminal") ?? "";
  const setClassId = (value: string) => setPicked((p) => ({ ...p, classId: value }));
  const setTerminalId = (value: string) => setPicked((p) => ({ ...p, terminalId: value }));

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.sheets.title")} subtitle={t("results.sheets.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={6} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.classes.length === 0 || view.data.terminals.length === 0 ? (
          <EmptyLine>{t("results.sheets.none")}</EmptyLine>
        ) : (
          <>
            <div className={`${readStyles.search} ${readStyles.searchWide}`}>
              <Select
                label={t("results.sheets.class")}
                value={classId}
                onChange={(event) => setClassId(event.target.value)}
                options={[{ value: "", label: t("results.choose") }, ...view.data.classes.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <Select
                label={t("results.terminal")}
                value={terminalId}
                onChange={(event) => setTerminalId(event.target.value)}
                options={[{ value: "", label: t("results.choose") }, ...view.data.terminals.map((x) => ({ value: x.id, label: x.name }))]}
              />
            </div>
            {classId && terminalId ? <ClassSheetView classId={classId} terminalId={terminalId} /> : <EmptyLine>{t("results.sheets.pick")}</EmptyLine>}
          </>
        )
      ) : null}
    </div>
  );
}

/** The sheet itself: rank, the student (kept in view while the subjects scroll), each subject, GPA or percentage, the result. Pure. */
export function SheetTable({ sheet }: { sheet: ClassSheet }) {
  return (
    <div className={readStyles.scroll} data-scroll tabIndex={0} role="region" aria-label={t("results.sheets.caption", { name: className(sheet), terminal: sheet.terminal.name })}>
      <table className={readStyles.sheet}>
        <caption className="sr-only">{t("results.sheets.caption", { name: className(sheet), terminal: sheet.terminal.name })}</caption>
        <thead>
          <tr>
            <th scope="col" data-align="end">
              {t("results.sheets.rank")}
            </th>
            <th scope="col" data-sticky>
              {t("results.grid.student")}
            </th>
            {sheet.subjects.map((x) => (
              <th key={x.offeringId} scope="col" data-align="center">
                {x.name}
              </th>
            ))}
            <th scope="col" data-align="end">
              {t(sheet.policy === "neb_gpa" ? "results.card.gpaLabel" : "results.card.percentLabel")}
            </th>
            <th scope="col">{t("results.card.result")}</th>
          </tr>
        </thead>
        <tbody>
          {sheet.students.map((x) => (
            <tr key={x.enrollmentId}>
              <td data-align="end">{x.rank ?? "–"}</td>
              <th scope="row" data-sticky>
                <Link href={`/portal/results/card?id=${x.cardId}`}>{x.name}</Link>
                <span className={readStyles.cellMeta}>{x.sid}</span>
              </th>
              {x.subjects.map((v, i) => (
                <td key={sheet.subjects[i]!.offeringId} data-align="center">
                  {v === null ? "–" : sheet.policy === "neb_gpa" ? v.grade : `${hundredthsText(v.percentHundredths)}%`}
                </td>
              ))}
              <td data-align="end">{scoreText(x) ?? "–"}</td>
              <td>
                <span className={readStyles.cellWords}>
                  {x.outcome}
                  {x.version > 1 ? <StatusWord>{t("results.sheets.corrected")}</StatusWord> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassSheetView({ classId, terminalId }: { classId: string; terminalId: string }) {
  const { api } = useSession();
  const [missing, setMissing] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadClassSheet(api, classId, terminalId);
    setMissing(!result.ok && result.reason === "not_found");
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId, terminalId]);
  const { view, reload } = useLoad<ClassSheet>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={6} />;
  if (view.status === "failed" && missing) return <EmptyLine>{t("results.sheets.notPublished")}</EmptyLine>;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const sheet = view.data;
  return (
    <Panel
      title={t("results.sheets.caption", { name: className(sheet), terminal: sheet.terminal.name })}
      labelledBy="sheet-heading"
      actions={
        <a className={`${buttonClass({ variant: "secondary" })} ${styles.wrapLabel}`} href={`/api/results/classes/${classId}/terminals/${terminalId}/sheet.csv`} download>
          <Download aria-hidden width={18} height={18} />
          {t("results.sheets.export")}
        </a>
      }
    >
      <SheetTable sheet={sheet} />
      <p className={readStyles.subtitle}>{t("results.sheets.ties")}</p>
    </Panel>
  );
}

/**
 * Rechecks (source 6.9). The Co-ordinator decides each open one: no change, or corrected marks, both with a reason. The
 * Admin sees the same list, read-only: every post-publish change with who made it and why (section 9's default).
 */
export function RechecksScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const decides = me?.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ?? false;
  const loadNow = useCallback(async () => {
    const result = await loadRechecks(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<RecheckList>(loadNow);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t(decides ? "results.rechecks.title" : "results.rechecks.changesTitle")} subtitle={t(decides ? "results.rechecks.subtitle" : "results.rechecks.changesSubtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.rechecks.length === 0 ? (
          <EmptyLine>{t(decides ? "results.rechecks.none" : "results.rechecks.noChanges")}</EmptyLine>
        ) : (
          <Panel>
            <RecheckList rechecks={view.data.rechecks} decide={decides ? (r) => <Decide recheck={r} onDone={() => void reload()} /> : undefined} />
          </Panel>
        )
      ) : null}
      {decides ? null : <ReadOnlyNote>{t("results.rechecks.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </div>
  );
}

/** A mark as read: "45 of 75" (the hundredths only when there are some), or Absent. */
const plain = (hundredths: number) => hundredthsText(hundredths).replace(/\.00$/, "");
const markRead = (m: RecheckList["rechecks"][number]["marks"][number]) => (m.absent ? t("results.rechecks.absent") : m.valueHundredths === null ? "–" : t("results.rechecks.markOf", { value: plain(m.valueHundredths), max: plain(m.maxHundredths) }));

/** Each recheck: who and which subject, the status in words, why it was asked, the marks now, and who decided, when and why. Pure. */
export function RecheckList({ rechecks, decide }: { rechecks: RecheckList["rechecks"]; decide?: (recheck: RecheckList["rechecks"][number]) => React.ReactNode }) {
  return (
    <ul className={readStyles.rows}>
      {rechecks.map((r) => (
        <li key={r.id} className={readStyles.rowItem}>
          <div className={readStyles.rowHead}>
            <h3 className={readStyles.rowTitle}>
              {r.studentName} · {r.subjectName}
            </h3>
            <StatusWord tone={r.status === "changed" ? "ok" : r.status === "open" ? "warn" : undefined}>{t(RECHECK_LABEL[r.status])}</StatusWord>
          </div>
          <p className={readStyles.rowMeta}>
            {r.sid} · {className(r)} · {r.terminalName}
            {r.requestedOnBs ? ` · ${t("results.rechecks.askedOn", { date: formatBsDate(r.requestedOnBs) })}` : ""}
          </p>
          <p>{t("results.rechecks.asked", { reason: r.reason })}</p>
          <p className={readStyles.rowMeta}>{t("results.rechecks.marksNow", { marks: r.marks.map((m) => `${m.name} ${markRead(m)}`).join(" · ") })}</p>
          {r.status !== "open" ? (
            <p className={readStyles.rowMeta}>
              {t("results.rechecks.decidedOn", {
                who: r.decidedBy ?? t("audit.bySystem"),
                date: r.decidedOnBs ? formatBsDate(r.decidedOnBs) : "",
                reason: r.decisionReason ?? "",
              })}
            </p>
          ) : null}
          {r.status === "open" && decide ? decide(r) : null}
        </li>
      ))}
    </ul>
  );
}

function Decide({ recheck, onDone }: { recheck: RecheckList["rechecks"][number]; onDone: () => void }) {
  const { api } = useSession();
  const [marks, setMarks] = useState<Record<string, string>>(() => Object.fromEntries(recheck.marks.map((m) => [m.componentId, markText(m)])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const changed = recheck.marks.some((m) => (marks[m.componentId] ?? "") !== markText(m));

  async function decide() {
    const corrected = [];
    for (const m of recheck.marks) {
      const parsed = parseMark(marks[m.componentId] ?? "");
      if (!parsed || (parsed.valueHundredths === null && !parsed.absent) || (parsed.valueHundredths !== null && parsed.valueHundredths > m.maxHundredths)) {
        return setMessage(t("results.rechecks.badMark", { component: m.name }));
      }
      corrected.push({ componentId: m.componentId, ...parsed });
    }
    setBusy(true);
    const sent = await decideRecheck(api, recheck.id, changed ? { outcome: "changed", reason: reason.trim(), marks: corrected } : { outcome: "unchanged", reason: reason.trim() });
    setBusy(false);
    if (sent.ok) onDone();
    else setMessage(sentText(sent));
  }

  return (
    <div className={styles.card}>
      {recheck.marks.map((m) => (
        <Field
          key={m.componentId}
          label={t("results.rechecks.mark", {
            name: m.name,
            max: hundredthsText(m.maxHundredths),
          })}
          inputMode="decimal"
          autoComplete="off"
          value={marks[m.componentId] ?? ""}
          onChange={(event) => setMarks((x) => ({ ...x, [m.componentId]: event.target.value }))}
        />
      ))}
      <Field
        label={t("results.rechecks.reason")}
        hint={t(changed ? "results.rechecks.reasonChanged" : "results.rechecks.reasonSame")}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" disabled={reason.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void decide()}>
          {t(changed ? "results.rechecks.saveChanged" : "results.rechecks.saveSame")}
        </Button>
      </div>
      {message ? <Notice tone="bad">{message}</Notice> : null}
    </div>
  );
}

/** Elective picks (D-056): for a class, each student's subject from each elective group. */
export function ElectivesScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadChoices(api), [api]);
  const { view, reload } = useLoad<Choices>(loadNow);
  const [classId, setClassId] = useState("");
  return (
    <>
      <h1 className={setupStyles.title}>{t("results.electives.title")}</h1>
      <p className={setupStyles.muted}>{t("results.electives.intro")}</p>
      <Gate view={view} onRetry={() => void reload()}>
        {(choices) =>
          choices.classes.length === 0 ? (
            <p className={setupStyles.empty}>{t("results.sheets.none")}</p>
          ) : (
            <>
              <Select
                label={t("results.sheets.class")}
                value={classId}
                onChange={(event) => setClassId(event.target.value)}
                options={[
                  { value: "", label: t("results.choose") },
                  ...choices.classes.map((c) => ({
                    value: c.id,
                    label: c.name,
                  })),
                ]}
              />
              {classId ? <ClassElectivesView classId={classId} /> : null}
            </>
          )
        }
      </Gate>
    </>
  );
}

function ClassElectivesView({ classId }: { classId: string }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadElectives(api, classId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId]);
  const { view, reload } = useLoad<ClassElectives>(loadNow);
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(data) =>
        data.groups.length === 0 ? (
          <p className={setupStyles.empty}>{t("results.electives.noGroups")}</p>
        ) : data.students.length === 0 ? (
          <p className={setupStyles.empty}>{t("results.grid.noStudents")}</p>
        ) : (
          <ul className={setupStyles.list}>
            {data.students.map((s) => (
              <li key={s.enrollmentId} className={setupStyles.item}>
                <h2 className={setupStyles.itemTitle}>{s.name}</h2>
                <p className={styles.meta}>{s.sid}</p>
                {data.groups.map((g) => (
                  <PickRow key={g.id} student={s} group={g} onSaved={() => void reload()} />
                ))}
              </li>
            ))}
          </ul>
        )
      }
    </Gate>
  );
}

function PickRow({ student, group, onSaved }: { student: ClassElectives["students"][number]; group: ClassElectives["groups"][number]; onSaved: () => void }) {
  const { api } = useSession();
  const current = group.subjects.filter((x) => student.picks.includes(x.offeringId)).map((x) => x.offeringId);
  const [picked, setPicked] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  const dirty = [...picked].sort().join() !== [...current].sort().join();

  async function save(next: string[]) {
    setBusy(true);
    setMessage(null);
    const sent = await setPicks(api, student.enrollmentId, group.id, next);
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: t("results.electives.saved") });
      onSaved();
    } else {
      setPicked(current);
      setMessage({ tone: "bad", text: sentText(sent)! });
    }
  }

  return (
    <div>
      {group.pickCount === 1 ? (
        <Select
          label={group.name}
          value={picked[0] ?? ""}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value ? [event.target.value] : [];
            setPicked(next);
            if (next.length === 1) void save(next);
          }}
          options={[
            { value: "", label: t("results.electives.none") },
            ...group.subjects.map((x) => ({
              value: x.offeringId,
              label: x.name,
            })),
          ]}
        />
      ) : (
        <fieldset className={styles.fieldset}>
          <legend>
            {t("results.electives.pickMany", {
              name: group.name,
              count: group.pickCount,
            })}
          </legend>
          {group.subjects.map((x) => (
            <Checkbox
              key={x.offeringId}
              label={x.name}
              checked={picked.includes(x.offeringId)}
              onChange={(event) => setPicked((p) => (event.target.checked ? [...p, x.offeringId] : p.filter((id) => id !== x.offeringId)))}
            />
          ))}
          <Button
            className={styles.wrapLabel}
            variant="secondary"
            disabled={!dirty || picked.length !== group.pickCount || busy}
            loading={busy}
            loadingLabel={t("results.saving")}
            onClick={() => void save(picked)}
          >
            {t("results.electives.save")}
          </Button>
        </fieldset>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
