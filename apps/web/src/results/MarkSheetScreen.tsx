"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Notice, Table } from "@/ui";

import { gateFailure, loadMySheets, loadSheet, saveMarks, submitSheet, type Sent } from "./client";
import { STATUS_LABEL, className, formatMarks, markText, parseMark, type MarkSheet, type MyMarkSheets } from "./model";
import styles from "./results.module.css";

export function sentText(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid" || sent.reason === "refused") return sent.message ?? t("results.refused");
  if (sent.reason === "closed") return t("results.closed");
  return t("results.failed");
}

/** The teacher's subjects this year, each with its mark sheet's state per terminal (source 6.2). */
export function MySheetsScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadMySheets(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<MyMarkSheets>(loadNow);
  return (
    <>
      <h1 className={setupStyles.title}>{t("results.mine.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(mine) =>
          mine.subjects.length === 0 ? (
            <p className={setupStyles.empty}>{t("results.mine.empty")}</p>
          ) : mine.terminals.length === 0 ? (
            <p className={setupStyles.empty}>{t("results.mine.noTerminals")}</p>
          ) : (
            <ul className={setupStyles.list}>
              {mine.subjects.map((s) => (
                <li key={`${s.classId}-${s.offeringId}`} className={setupStyles.item}>
                  <h2 className={setupStyles.itemTitle}>{s.subjectName}</h2>
                  <p className={styles.meta}>{className(s)}</p>
                  <ul className={styles.list}>
                    {s.sheets.map((sheet) => {
                      const name = mine.terminals.find((x) => x.id === sheet.terminalId)?.name ?? "";
                      return (
                        <li key={sheet.terminalId} className={styles.row}>
                          <Link href={`/portal/results/sheet?class=${s.classId}&subject=${s.offeringId}&terminal=${sheet.terminalId}`}>{name}</Link>
                          <span className={styles.state}>
                            <Badge tone={sheet.status === "draft" && sheet.note ? "bad" : undefined}>
                              {t(sheet.status === "draft" && sheet.note ? "results.status.sentBack" : STATUS_LABEL[sheet.status])}
                            </Badge>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )
        }
      </Gate>
    </>
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

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(sheet) => (
        // A fresh editor for each saved state of the sheet, so the boxes always start from what the server holds.
        <SheetEditor key={`${sheet.status}:${JSON.stringify(sheet.students.map((s) => s.marks))}`} sheet={sheet} reload={reload} message={message} setMessage={setMessage} />
      )}
    </Gate>
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
  return (
    <>
      <h1 className={setupStyles.title}>{sheet.subjectName}</h1>
      <p className={styles.meta}>
        {className(sheet)} · {sheet.terminal.name}
      </p>
      <div className={styles.actions}>
        <Badge>{t(STATUS_LABEL[sheet.status])}</Badge>
        {editable && missing > 0 ? <span className={styles.meta}>{t("results.grid.missing", { count: missing })}</span> : null}
      </div>
      {sheet.note && editable ? <Notice tone="bad">{t("results.grid.note", { note: sheet.note })}</Notice> : null}
      {!editable ? <Notice>{t("results.grid.locked")}</Notice> : null}
      {sheet.students.length === 0 || sheet.components.length === 0 ? (
        <p className={setupStyles.empty}>{t(sheet.components.length === 0 ? "results.grid.noComponents" : "results.grid.noStudents")}</p>
      ) : (
        <>
          {editable ? <p className={styles.meta}>{t("results.grid.hint")}</p> : null}
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
        </>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <p>
        <Link href="/portal/results">{t("results.grid.back")}</Link>
      </p>
    </>
  );
}
