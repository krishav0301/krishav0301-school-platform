"use client";

import { CircleCheck, Download, Hourglass, PenLine, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { loadClasses, loadTerminals, loadYears } from "@/setup/client";
import { useLoad } from "@/setup/useLoad";
import { Button, Checkbox, Field, Notice, Select, buttonClass } from "@/ui";

import { decideRecheck, gateFailure, loadClassSheet, loadElectives, loadRechecks, setPicks } from "./client";
import { sentText } from "./MarkSheetScreen";
import { RECHECK_LABEL, className, hundredthsText, markText, parseMark, partName, scoreText, type ClassElectives, type ClassSheet, type RecheckList } from "./model";
import styles from "./results.module.css";

/** The picker's value for the final result rather than one exam. */
const FINAL = "final";

/** "First terminal", or "Final result". */
const sheetName = (sheet: ClassSheet) => (sheet.terminal ? sheet.terminal.name : t("results.sheets.final"));

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
      // The term's exams in its pattern, then its final result (D-117).
      terminals: [
        ...terminals.data.terminals.filter((x) => x.weight !== null).map((x) => ({ id: x.id, name: x.name })),
        ...(terminals.data.terminals.some((x) => x.weight !== null) ? [{ id: FINAL, name: t("results.sheets.final") }] : []),
      ],
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

/**
 * The sheet itself: the student (kept in view while the subjects scroll), each subject, the percentage, the result. On
 * the final result also the rank in the class (an exam's sheet is for information, D-117). Pure.
 */
export function SheetTable({ sheet }: { sheet: ClassSheet }) {
  const isFinal = sheet.terminal === null;
  return (
    <div className={readStyles.scroll} data-scroll tabIndex={0} role="region" aria-label={t("results.sheets.caption", { name: className(sheet), terminal: sheetName(sheet) })}>
      <table className={readStyles.sheet}>
        <caption className="sr-only">{t("results.sheets.caption", { name: className(sheet), terminal: sheetName(sheet) })}</caption>
        <thead>
          <tr>
            {isFinal ? (
              <th scope="col" data-align="end">
                {t("results.sheets.rank")}
              </th>
            ) : null}
            <th scope="col" data-sticky>
              {t("results.grid.student")}
            </th>
            {sheet.subjects.map((x) => (
              <th key={x.offeringId} scope="col" data-align="center">
                {x.name}
              </th>
            ))}
            <th scope="col" data-align="end">
              {t("results.card.percentLabel")}
            </th>
            <th scope="col">{t("results.card.result")}</th>
          </tr>
        </thead>
        <tbody>
          {sheet.students.map((x) => (
            <tr key={x.enrollmentId}>
              {isFinal ? <td data-align="end">{x.rank ?? "–"}</td> : null}
              <th scope="row" data-sticky>
                <Link href={`/portal/results/card?id=${x.cardId}`}>{x.name}</Link>
                <span className={readStyles.cellMeta}>{x.sid}</span>
              </th>
              {x.subjects.map((v, i) => (
                <td key={sheet.subjects[i]!.offeringId} data-align="center">
                  {v === null ? "–" : sheet.graded && v.grade ? `${hundredthsText(v.percentHundredths)} (${v.grade})` : hundredthsText(v.percentHundredths)}
                </td>
              ))}
              <td data-align="end">{scoreText(x)}</td>
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

/** One published sheet. `exportable`: offer the CSV, which needs the reports permission (not a Class Teacher's, FUT point 19). */
export function ClassSheetView({ classId, terminalId, exportable = true }: { classId: string; terminalId: string; exportable?: boolean }) {
  const { api } = useSession();
  const [missing, setMissing] = useState(false);
  const isFinal = terminalId === FINAL;
  const loadNow = useCallback(async () => {
    const result = await loadClassSheet(api, classId, isFinal ? null : terminalId);
    setMissing(!result.ok && result.reason === "not_found");
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId, terminalId, isFinal]);
  const { view, reload } = useLoad<ClassSheet>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={6} />;
  if (view.status === "failed" && missing) return <EmptyLine>{t("results.sheets.notPublished")}</EmptyLine>;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const sheet = view.data;
  return (
    <Panel
      title={t("results.sheets.caption", { name: className(sheet), terminal: sheetName(sheet) })}
      labelledBy="sheet-heading"
      actions={
        exportable ? (
        <a className={`${buttonClass({ variant: "secondary" })} ${styles.wrapLabel}`} href={isFinal ? `/api/results/classes/${classId}/final/sheet.csv` : `/api/results/classes/${classId}/terminals/${terminalId}/sheet.csv`} download>
          <Download aria-hidden width={18} height={18} />
          {t("results.sheets.export")}
        </a>
        ) : undefined
      }
    >
      <SheetTable sheet={sheet} />
      <p className={readStyles.subtitle}>{t(isFinal ? "results.sheets.ties" : "results.sheets.forInformation")}</p>
    </Panel>
  );
}

/** Three figures for the person who decides: rechecks waiting, marks changed, and kept as they were. Pure. */
export function recheckFigures(rechecks: RecheckList["rechecks"]): Figure[] {
  return [
    { key: "open", icon: Hourglass, tone: "warn", value: String(rechecks.filter((r) => r.status === "open").length), label: t("results.rechecks.figure.open") },
    { key: "changed", icon: PenLine, tone: "ok", value: String(rechecks.filter((r) => r.status === "changed").length), label: t("results.rechecks.figure.changed") },
    { key: "unchanged", icon: CircleCheck, tone: "accent", value: String(rechecks.filter((r) => r.status !== "open" && r.status !== "changed").length), label: t("results.rechecks.figure.unchanged") },
  ];
}

/**
 * Rechecks (source 6.9). The Co-ordinator decides each open one in a side panel (D-106): no change, or corrected marks,
 * both with a reason. The Admin sees the same list, read-only: every post-publish change with who made it and why
 * (section 9's default).
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
  const [open, setOpen] = useState<RecheckList["rechecks"][number] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t(decides ? "results.rechecks.title" : "results.rechecks.changesTitle")} subtitle={t(decides ? "results.rechecks.subtitle" : "results.rechecks.changesSubtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={decides ? 3 : 0} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {view.status === "ready" ? (
        view.data.rechecks.length === 0 ? (
          <EmptyLine>{t(decides ? "results.rechecks.none" : "results.rechecks.noChanges")}</EmptyLine>
        ) : (
          <>
            {decides ? <FigureTiles figures={recheckFigures(view.data.rechecks)} label={t("results.rechecks.figures")} /> : null}
            <Panel>
              <RecheckList
                rechecks={view.data.rechecks}
                decide={
                  decides
                    ? (r) => (
                        <div>
                          <Button variant="secondary" aria-label={t("results.rechecks.decideItem", { name: r.studentName, subject: r.subjectName })} onClick={() => setOpen(r)}>
                            {t("results.rechecks.decide")}
                          </Button>
                        </div>
                      )
                    : undefined
                }
              />
            </Panel>
          </>
        )
      ) : null}
      {decides ? null : <ReadOnlyNote>{t("results.rechecks.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
      {open ? (
        <DecidePanel
          recheck={open}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setOpen(null);
            setDone(text);
            void reload();
          }}
        />
      ) : null}
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
          <p className={readStyles.rowMeta}>{t("results.rechecks.marksNow", { marks: r.marks.map((m) => `${partName(m.componentId)} ${markRead(m)}`).join(" · ") })}</p>
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

/** One open recheck, decided in a side panel: the facts, the marks (changed or not), a reason, and one button. */
export function DecidePanel({ recheck, onClose, onDone }: { recheck: RecheckList["rechecks"][number]; onClose: () => void; onDone: (text: string) => void }) {
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
        return setMessage(t("results.rechecks.badMark", { component: partName(m.componentId) }));
      }
      corrected.push({ componentId: m.componentId, ...parsed });
    }
    setBusy(true);
    const sent = await decideRecheck(api, recheck.id, changed ? { outcome: "changed", reason: reason.trim(), marks: corrected } : { outcome: "unchanged", reason: reason.trim() });
    setBusy(false);
    if (sent.ok) onDone(t(changed ? "results.rechecks.doneChanged" : "results.rechecks.doneSame", { name: recheck.studentName, subject: recheck.subjectName }));
    else setMessage(sentText(sent));
  }

  return (
    <SidePanel
      title={`${recheck.studentName} · ${recheck.subjectName}`}
      subtitle={`${recheck.sid} · ${className(recheck)} · ${recheck.terminalName}`}
      status={<StatusWord tone="warn">{t(RECHECK_LABEL[recheck.status])}</StatusWord>}
      busy={busy}
      onClose={onClose}
      foot={
        <Button fullWidth disabled={reason.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void decide()}>
          {t(changed ? "results.rechecks.saveChanged" : "results.rechecks.saveSame")}
        </Button>
      }
    >
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Facts
        rows={[
          { name: t("results.rechecks.askedLabel"), value: recheck.reason },
          ...(recheck.requestedOnBs ? [{ name: t("results.rechecks.askedOnLabel"), value: formatBsDate(recheck.requestedOnBs) }] : []),
          { name: t("results.rechecks.marksNowLabel"), value: recheck.marks.map((m) => `${partName(m.componentId)} ${markRead(m)}`).join(" · ") },
        ]}
      />
      <PanelSection title={t("results.rechecks.marksTitle")}>
        <p className={readStyles.rowMeta}>{t("results.rechecks.marksHint")}</p>
        {recheck.marks.map((m) => (
          <Field
            key={m.componentId}
            label={t("results.rechecks.mark", { name: partName(m.componentId), max: hundredthsText(m.maxHundredths) })}
            inputMode="decimal"
            autoComplete="off"
            value={marks[m.componentId] ?? ""}
            onChange={(event) => {
              setMarks((x) => ({ ...x, [m.componentId]: event.target.value }));
              setMessage(null);
            }}
          />
        ))}
      </PanelSection>
      <Field label={t("results.rechecks.reason")} hint={t(changed ? "results.rechecks.reasonChanged" : "results.rechecks.reasonSame")} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    </SidePanel>
  );
}

/** Three figures for one class's electives: its students, those with every pick made, and those still to choose. Pure. */
export function electiveFigures(data: ClassElectives): Figure[] {
  const complete = data.students.filter((s) => data.groups.every((g) => g.subjects.filter((x) => s.picks.includes(x.offeringId)).length === g.pickCount)).length;
  return [
    { key: "students", icon: UsersRound, tone: "accent", value: String(data.students.length), label: t("results.electives.figure.students") },
    { key: "complete", icon: CircleCheck, tone: "ok", value: String(complete), label: t("results.electives.figure.complete") },
    { key: "left", icon: Hourglass, tone: data.students.length - complete > 0 ? "warn" : "ok", value: String(data.students.length - complete), label: t("results.electives.figure.left") },
  ];
}

/** Elective picks (D-056), redesigned in D-106: for a class (the first open straight away), each student's subject from each elective group. */
export function ElectivesScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadChoices(api), [api]);
  const { view, reload } = useLoad<Choices>(loadNow);
  const [picked, setClassId] = useState("");
  const classes = view.status === "ready" ? view.data.classes : [];
  const classId = picked || (classes[0]?.id ?? "");
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.electives.title")} subtitle={t("results.electives.intro")} />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" && classes.length === 0 ? <EmptyLine>{t("results.sheets.none")}</EmptyLine> : null}
      {classes.length > 0 ? (
        <>
          <div className={readStyles.search}>
            <Select label={t("results.sheets.class")} value={classId} onChange={(event) => setClassId(event.target.value)} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
          <ClassElectivesView key={classId} classId={classId} />
        </>
      ) : null}
    </div>
  );
}

function ClassElectivesView({ classId }: { classId: string }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadElectives(api, classId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId]);
  const { view, reload } = useLoad<ClassElectives>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={6} tiles={3} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <ElectivesView data={view.data} onSaved={() => void reload()} />;
}

/** One class's students, each with a picker for each elective group, and the group's state in words. Pure. */
export function ElectivesView({ data, onSaved }: { data: ClassElectives; onSaved: () => void }) {
  if (data.groups.length === 0) return <EmptyLine>{t("results.electives.noGroups")}</EmptyLine>;
  if (data.students.length === 0) return <EmptyLine>{t("results.grid.noStudents")}</EmptyLine>;
  return (
    <>
      <FigureTiles figures={electiveFigures(data)} label={t("results.electives.figures")} />
      <Panel title={className(data)} labelledBy="electives-class">
        <ul className={readStyles.rows}>
          {data.students.map((s) => (
            <li key={s.enrollmentId} className={`${readStyles.rowItem} ${styles.pickRow}`}>
              <div>
                <h3 className={readStyles.rowTitle}>{s.name}</h3>
                <p className={readStyles.rowMeta}>{s.sid}</p>
              </div>
              <div className={styles.picks}>
                {data.groups.map((g) => (
                  <PickRow key={g.id} student={s} group={g} onSaved={onSaved} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </>
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
      {message?.tone === "ok" ? (
        <p className={readStyles.rowMeta} role="status">
          {message.text}
        </p>
      ) : message ? (
        <Notice tone="bad">{message.text}</Notice>
      ) : null}
    </div>
  );
}
