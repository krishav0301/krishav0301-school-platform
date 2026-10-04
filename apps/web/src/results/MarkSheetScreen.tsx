"use client";

import { CircleCheck, Hourglass, PenLine, Undo2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, Segments, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice, Table } from "@/ui";

import { gateFailure, loadMySheets, loadSheet, saveMarks, submitSheet, type Sent } from "./client";
import { STATUS_LABEL, className, formatMarks, markText, parseMark, type MarkSheet, type MyMarkSheets, type SheetStatus } from "./model";
import styles from "./results.module.css";

export function sentText(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid" || sent.reason === "refused") return sent.message ?? t("results.refused");
  if (sent.reason === "closed") return t("results.closed");
  return t("results.failed");
}

type MySheet = { classId: string; offeringId: string; subjectName: string; className: string; terminalId: string; status: SheetStatus; sentBack: boolean };

/** Every sheet of one terminal, the ones that need the teacher first (sent back, then started, then not started). Pure. */
export function sheetsOf(mine: MyMarkSheets, terminalId: string): MySheet[] {
  const rows = mine.subjects.flatMap((s) =>
    s.sheets.filter((x) => x.terminalId === terminalId).map((x) => ({ classId: s.classId, offeringId: s.offeringId, subjectName: s.subjectName, className: className(s), terminalId, status: x.status, sentBack: x.status === "draft" && x.note !== null })),
  );
  const rank = (r: MySheet) => (r.sentBack ? 0 : r.status === "draft" ? 1 : r.status === "not_started" ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** The terminal to show first: the latest one the teacher has started, else the first. */
export function currentTerminal(mine: MyMarkSheets): string {
  const started = mine.terminals.filter((term) => mine.subjects.some((s) => s.sheets.some((x) => x.terminalId === term.id && x.status !== "not_started")));
  return (started[started.length - 1] ?? mine.terminals[0])?.id ?? "";
}

export function mySheetFigures(rows: readonly MySheet[]): Figure[] {
  const count = (test: (r: MySheet) => boolean) => rows.filter(test).length;
  return [
    { key: "todo", icon: PenLine, tone: count((r) => r.status === "not_started" || r.status === "draft") > 0 ? "warn" : "ok", value: String(count((r) => r.status === "not_started" || r.status === "draft")), label: t("results.mine.figure.todo") },
    { key: "back", icon: Undo2, tone: count((r) => r.sentBack) > 0 ? "bad" : "ok", value: String(count((r) => r.sentBack)), label: t("results.mine.figure.sentBack") },
    { key: "review", icon: Hourglass, tone: "accent", value: String(count((r) => r.status === "under_review")), label: t("results.mine.figure.review") },
    { key: "done", icon: CircleCheck, tone: "ok", value: String(count((r) => r.status === "verified" || r.status === "published")), label: t("results.mine.figure.done") },
  ];
}

const sheetTone = (r: MySheet): "ok" | "bad" | "warn" | undefined => (r.sentBack ? "bad" : r.status === "draft" || r.status === "not_started" ? "warn" : r.status === "under_review" ? undefined : "ok");

/** One terminal's sheets: subject, class, status in words, and the sheet to open. Pure. */
export function MySheetsTable({ rows, terminalName }: { rows: readonly MySheet[]; terminalName: string }) {
  if (rows.length === 0) return <EmptyLine>{t("results.mine.empty")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("results.mine.caption", { terminal: terminalName })}
      rows={rows}
      rowKey={(r) => `${r.classId}-${r.offeringId}`}
      columns={[
        { key: "subject", label: t("results.mine.subject"), primary: true, cell: (r) => r.subjectName },
        { key: "class", label: t("attendance.col.class"), cell: (r) => r.className },
        { key: "status", label: t("attendance.class.status"), cell: (r) => <StatusWord tone={sheetTone(r)}>{t(r.sentBack ? "results.status.sentBack" : STATUS_LABEL[r.status])}</StatusWord> },
        {
          key: "open",
          label: t("results.mine.sheet"),
          align: "end",
          plain: true,
          cell: (r) => (
            <OpenLink
              href={`/portal/results/sheet?class=${r.classId}&subject=${r.offeringId}&terminal=${r.terminalId}`}
              label={t("results.mine.openNamed", { subject: r.subjectName, name: r.className })}
              text={t(r.status === "not_started" || r.status === "draft" ? "results.mine.enter" : "read.open")}
            />
          ),
        },
      ]}
    />
  );
}

/** The teacher's mark sheets (source 6.2; redesigned in D-107): one terminal at a time, what needs them first. */
export function MySheetsScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadMySheets(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<MyMarkSheets>(loadNow);
  const [picked, setPicked] = useState<string | null>(null);
  const mine = view.status === "ready" ? view.data : null;
  const terminalId = mine ? (picked ?? currentTerminal(mine)) : "";
  const terminalName = mine?.terminals.find((x) => x.id === terminalId)?.name ?? "";
  const rows = mine ? sheetsOf(mine, terminalId) : [];
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.mine.title")} subtitle={t("results.mine.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={5} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {mine ? (
        mine.subjects.length === 0 || mine.terminals.length === 0 ? (
          <Panel>
            <EmptyLine>{t(mine.subjects.length === 0 ? "results.mine.empty" : "results.mine.noTerminals")}</EmptyLine>
          </Panel>
        ) : (
          <>
            {mine.terminals.length > 1 ? <Segments label={t("results.mine.terminals")} value={terminalId} options={mine.terminals.map((x) => ({ key: x.id, label: x.name }))} onChange={setPicked} /> : null}
            <FigureTiles figures={mySheetFigures(rows)} label={t("results.mine.figures", { terminal: terminalName })} />
            <Panel title={terminalName} labelledBy="my-sheets">
              <MySheetsTable rows={rows} terminalName={terminalName} />
            </Panel>
          </>
        )
      ) : null}
    </div>
  );
}

type Draft = Record<string, string>;
const key = (enrollmentId: string, componentId: string) => `${enrollmentId}/${componentId}`;

/** The marks grid: students down, components across. Read-only unless `editable`. */
export function SheetGrid({ sheet, draft, onChange, editable }: { sheet: MarkSheet; draft: Draft; onChange?: (k: string, value: string) => void; editable: boolean }) {
  return (
    <Table
      caption={t("results.grid.caption", {
        subject: sheet.subjectName,
        terminal: sheet.terminal.name,
      })}
    >
      <thead>
        <tr>
          <th scope="col">{t("results.grid.student")}</th>
          {sheet.components.map((c) => (
            <th key={c.id} scope="col" className={styles.number}>
              {t(c.kind === "practical" ? "results.grid.componentPractical" : "results.grid.component", { name: c.name, max: formatMarks(c.maxHundredths) })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.students.map((s) => (
          <tr key={s.enrollmentId}>
            <th scope="row">
              {s.name}
              <br />
              <span className={styles.meta}>{s.sid}</span>
            </th>
            {sheet.components.map((c) => {
              const k = key(s.enrollmentId, c.id);
              const value = draft[k] ?? "";
              const parsed = parseMark(value);
              const bad = parsed === null || (parsed.valueHundredths !== null && parsed.valueHundredths > c.maxHundredths);
              return (
                <td key={c.id} className={styles.number}>
                  {editable ? (
                    <input
                      className={styles.markInput}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={t("results.grid.markLabel", {
                        student: s.name,
                        component: c.name,
                      })}
                      aria-invalid={bad ? true : undefined}
                      value={value}
                      onChange={(event) => onChange?.(k, event.target.value)}
                    />
                  ) : (
                    value || "–"
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** What the grid starts from: every recorded mark as text. */
export const draftOf = (sheet: MarkSheet): Draft => Object.fromEntries(sheet.students.flatMap((s) => s.marks.map((m) => [key(s.enrollmentId, m.componentId), markText(m)])));

/** The teacher's grid for one subject, class and terminal (`?class=&subject=&terminal=`): save drafts, then send for review. */
export function MarkSheetScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const [classId, offeringId, terminalId] = [params.get("class") ?? "", params.get("subject") ?? "", params.get("terminal") ?? ""];
  const loadNow = useCallback(async () => {
    if (!classId || !offeringId || !terminalId) return gateFailure("failed");
    const result = await loadSheet(api, classId, offeringId, terminalId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId, offeringId, terminalId]);
  const { view, reload } = useLoad<MarkSheet>(loadNow);
  const [message, setMessage] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);

  if (view.status === "ready") {
    const sheet = view.data;
    // A fresh editor for each saved state of the sheet, so the boxes always start from what the server holds.
    return <SheetEditor key={`${sheet.status}:${JSON.stringify(sheet.students.map((s) => s.marks))}`} sheet={sheet} reload={reload} message={message} setMessage={setMessage} />;
  }
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.mine.title")} crumbs={[{ label: t("results.mine.title"), href: "/portal/results" }]} />
      {view.status === "loading" ? <TableSkeleton rows={8} /> : <ReadFailure status={view.status === "forbidden" ? "forbidden" : "failed"} onRetry={() => void reload()} />}
    </div>
  );
}

function SheetEditor({
  sheet,
  reload,
  message,
  setMessage,
}: {
  sheet: MarkSheet;
  reload: () => Promise<void>;
  message: { tone: "ok" | "bad"; text: string } | null;
  setMessage: (m: { tone: "ok" | "bad"; text: string } | null) => void;
}) {
  const { api } = useSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(sheet));
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);

  async function save(): Promise<boolean> {
    const marks = [];
    for (const s of sheet.students) {
      for (const c of sheet.components) {
        const parsed = parseMark(draft[key(s.enrollmentId, c.id)] ?? "");
        if (parsed === null || (parsed.valueHundredths !== null && parsed.valueHundredths > c.maxHundredths)) {
          setMessage({
            tone: "bad",
            text: t("results.grid.badMark", {
              student: s.name,
              component: c.name,
            }),
          });
          return false;
        }
        marks.push({
          enrollmentId: s.enrollmentId,
          componentId: c.id,
          ...parsed,
        });
      }
    }
    const sent = await saveMarks(api, sheet.classId, sheet.offeringId, sheet.terminal.id, marks);
    if (!sent.ok) setMessage({ tone: "bad", text: sentText(sent)! });
    return sent.ok;
  }

  async function onSave() {
    setBusy("save");
    setMessage(null);
    const saved = await save();
    setBusy(null);
    if (saved) {
      setMessage({ tone: "ok", text: t("results.grid.saved") });
      await reload();
    }
  }

  async function onSubmit() {
    setBusy("submit");
    setMessage(null);
    if (await save()) {
      const sent = await submitSheet(api, sheet.classId, sheet.offeringId, sheet.terminal.id);
      setBusy(null);
      setMessage(sent.ok ? { tone: "ok", text: t("results.grid.submitted") } : { tone: "bad", text: sentText(sent)! });
      await reload();
    } else setBusy(null);
  }

  const editable = sheet.status === "draft" || sheet.status === "not_started";
  const missing = sheet.students.length * sheet.components.length - Object.values(draft).filter((v) => v.trim() !== "").length;
  const sentBack = sheet.status === "draft" && sheet.note !== null;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={sheet.subjectName}
        subtitle={`${className(sheet)} · ${sheet.terminal.name}`}
        crumbs={[{ label: t("results.mine.title"), href: "/portal/results" }, { label: sheet.subjectName }]}
        actions={<StatusWord tone={sentBack ? "bad" : editable ? "warn" : sheet.status === "under_review" ? undefined : "ok"}>{t(sentBack ? "results.status.sentBack" : STATUS_LABEL[sheet.status])}</StatusWord>}
      />
      {sheet.note && editable ? <Notice tone="bad">{t("results.grid.note", { note: sheet.note })}</Notice> : null}
      {!editable ? <ReadOnlyNote>{t("results.grid.locked")}</ReadOnlyNote> : null}
      {sheet.students.length === 0 || sheet.components.length === 0 ? (
        <Panel>
          <EmptyLine>{t(sheet.components.length === 0 ? "results.grid.noComponents" : "results.grid.noStudents")}</EmptyLine>
        </Panel>
      ) : (
        <Panel title={t("results.grid.title")} labelledBy="sheet-grid" actions={editable ? <span className={readStyles.rowMeta}>{missing > 0 ? t("results.grid.missing", { count: missing }) : t("results.grid.complete")}</span> : null}>
          {editable ? <p className={readStyles.rowMeta}>{t("results.grid.hint")}</p> : null}
          <SheetGrid sheet={sheet} draft={draft} editable={editable} onChange={(k, value) => setDraft((d) => ({ ...d, [k]: value }))} />
          {editable ? (
            <div className={styles.actions}>
              <Button className={styles.wrapLabel} onClick={() => void onSubmit()} loading={busy === "submit"} loadingLabel={t("results.saving")} disabled={busy !== null || missing > 0}>
                {t("results.grid.submit")}
              </Button>
              <Button className={styles.wrapLabel} variant="secondary" onClick={() => void onSave()} loading={busy === "save"} loadingLabel={t("results.saving")} disabled={busy !== null}>
                {t("results.grid.save")}
              </Button>
            </div>
          ) : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </Panel>
      )}
    </div>
  );
}
