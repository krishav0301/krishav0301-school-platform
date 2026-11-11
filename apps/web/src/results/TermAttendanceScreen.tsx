"use client";

import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import {
  EmptyLine,
  Panel,
  ReadFailure,
  ReadHeader,
  ReadOnlyNote,
  TableSkeleton,
  readStyles,
} from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice } from "@/ui";

import { gateFailure, loadTermAttendance, saveTermAttendance } from "./client";
import { className, hundredthsText, type TermAttendance } from "./model";
import styles from "./results.module.css";

/** A whole number of days from `min` to 366 as typed, or null when it is not one (an empty box is not a number). Pure. */
export function parseDays(text: string, min: number): number | null {
  const v = text.trim();
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= 366 ? n : null;
}

/** Days present over working days as the card prints it ("90.00"), or "" when either is not a usable number. Pure. */
export function percentText(present: string, working: string): string {
  const w = parseDays(working, 1);
  const p = parseDays(present, 0);
  if (w === null || p === null || p > w) return "";
  return hundredthsText(Math.floor((2 * p * 10_000 + w) / (2 * w)));
}

type Draft = { working: string; present: Record<string, string> };

const draftOf = (a: TermAttendance): Draft => ({
  working: a.workingDays === null ? "" : String(a.workingDays),
  present: Object.fromEntries(
    a.students.map((s) => [
      s.enrollmentId,
      s.daysPresent === null ? "" : String(s.daysPresent),
    ]),
  ),
});

/** The first thing wrong with what is typed, as words; null when it can be saved. Pure. */
export function problemWith(a: TermAttendance, draft: Draft): string | null {
  const working = parseDays(draft.working, 1);
  if (working === null) return t("results.attendance.badWorking");
  for (const s of a.students) {
    const text = (draft.present[s.enrollmentId] ?? "").trim();
    if (text === "") continue;
    const p = parseDays(text, 0);
    if (p === null || p > working)
      return t("results.attendance.badPresent", { student: s.name });
  }
  return null;
}

function Editor({
  attendance,
  reload,
}: {
  attendance: TermAttendance;
  reload: () => Promise<void>;
}) {
  const { api } = useSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(attendance));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  const [asked, setAsked] = useState(false);
  const problem = problemWith(attendance, draft);
  const given = attendance.students.filter(
    (s) => (draft.present[s.enrollmentId] ?? "").trim() !== "",
  ).length;
  const workingBad = parseDays(draft.working, 1) === null;

  async function save() {
    setAsked(true);
    if (problem) return;
    setBusy(true);
    setMessage(null);
    const sent = await saveTermAttendance(
      api,
      attendance.classId,
      attendance.terminalId,
      parseDays(draft.working, 1)!,
      attendance.students.map((s) => ({
        enrollmentId: s.enrollmentId,
        daysPresent: parseDays(draft.present[s.enrollmentId] ?? "", 0),
      })),
    );
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: t("results.attendance.saved") });
      await reload();
    } else
      setMessage({
        tone: "bad",
        text:
          sent.reason === "closed"
            ? t("results.attendance.locked")
            : sent.reason === "invalid" || sent.reason === "refused"
              ? (sent.message ?? t("results.attendance.failed"))
              : t("results.attendance.failed"),
      });
  }

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("results.attendance.title")}
        subtitle={t("results.attendance.subtitle", {
          class: className(attendance),
          exam: attendance.terminalName,
        })}
        crumbs={[
          { label: t("classes.title"), href: "/portal/classes" },
          {
            label: className(attendance),
            href: `/portal/classes/class?id=${attendance.classId}&tab=results`,
          },
          { label: t("results.attendance.crumb") },
        ]}
      />
      {attendance.locked ? (
        <ReadOnlyNote>{t("results.attendance.locked")}</ReadOnlyNote>
      ) : null}
      <Panel
        title={t("results.attendance.working")}
        labelledBy="attendance-working"
      >
        <p className={readStyles.rowMeta}>
          {t("results.attendance.workingHint")}
        </p>
        <input
          className={styles.markInput}
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          aria-labelledby="attendance-working"
          aria-invalid={asked && workingBad ? true : undefined}
          disabled={attendance.locked}
          value={draft.working}
          onFocus={(event) => event.target.select()}
          onChange={(event) =>
            setDraft((d) => ({ ...d, working: event.target.value }))
          }
        />
      </Panel>
      <Panel
        title={t("results.attendance.student")}
        labelledBy="attendance-students"
        actions={
          <span className={readStyles.rowMeta}>
            {t("results.attendance.given", {
              count: given,
              total: attendance.students.length,
            })}
          </span>
        }
      >
        {attendance.students.length === 0 ? (
          <EmptyLine>{t("results.attendance.noStudents")}</EmptyLine>
        ) : (
          <>
            <p className={readStyles.rowMeta}>{t("results.attendance.hint")}</p>
            <div
              className={styles.gridScroll}
              tabIndex={0}
              role="region"
              aria-label={t("results.attendance.title")}
            >
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th scope="col">{t("results.attendance.student")}</th>
                    <th scope="col" className={styles.number}>
                      {t("results.attendance.present")}
                    </th>
                    <th scope="col" className={styles.number}>
                      {t("results.attendance.percent")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.students.map((s) => {
                    const value = draft.present[s.enrollmentId] ?? "";
                    const working = parseDays(draft.working, 1);
                    const parsed = parseDays(value, 0);
                    const bad =
                      value.trim() !== "" &&
                      (parsed === null ||
                        (working !== null && parsed > working));
                    return (
                      <tr key={s.enrollmentId}>
                        <th scope="row" className={styles.gridName}>
                          {s.name}
                          <br />
                          <span className={styles.meta}>
                            {s.rollNo !== null
                              ? `${s.rollNo} · ${s.sid}`
                              : s.sid}
                          </span>
                        </th>
                        <td
                          className={styles.number}
                          data-label={t("results.attendance.present")}
                        >
                          <input
                            data-mark=""
                            className={styles.markInput}
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={3}
                            aria-label={t("results.attendance.presentLabel", {
                              student: s.name,
                            })}
                            aria-invalid={bad ? true : undefined}
                            disabled={attendance.locked}
                            value={value}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) =>
                              setDraft((d) => ({
                                ...d,
                                present: {
                                  ...d.present,
                                  [s.enrollmentId]: event.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td
                          className={styles.number}
                          data-label={t("results.attendance.percent")}
                        >
                          {percentText(value, draft.working) === ""
                            ? "–"
                            : `${percentText(value, draft.working)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {asked && problem ? <Notice tone="bad">{problem}</Notice> : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {attendance.locked ? null : (
          <div className={styles.actions}>
            <Button
              className={styles.wrapLabel}
              onClick={() => void save()}
              loading={busy}
              loadingLabel={t("results.saving")}
              disabled={busy}
            >
              {t("results.attendance.save")}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** The Class Teacher's attendance for an exam's marks card (`?class=&exam=`): the working days, then each student's days present. */
export function TermAttendanceScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const [classId, terminalId] = [
    params.get("class") ?? "",
    params.get("exam") ?? "",
  ];
  const loadNow = useCallback(async () => {
    if (!classId || !terminalId) return gateFailure("failed");
    const result = await loadTermAttendance(api, classId, terminalId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, classId, terminalId]);
  const { view, reload } = useLoad<TermAttendance>(loadNow);
  if (view.status === "ready") {
    // A fresh editor for each saved state, so the boxes start from what the server holds.
    return (
      <Editor
        key={JSON.stringify([
          view.data.workingDays,
          view.data.students.map((s) => s.daysPresent),
        ])}
        attendance={view.data}
        reload={reload}
      />
    );
  }
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.attendance.title")} />
      {view.status === "loading" ? (
        <TableSkeleton rows={8} />
      ) : (
        <ReadFailure
          status={view.status === "forbidden" ? "forbidden" : "failed"}
          onRetry={() => void reload()}
        />
      )}
    </div>
  );
}
