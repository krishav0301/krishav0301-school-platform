"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Checkbox, Field, Notice, Select } from "@/ui";

import { gateFailure, loadBoard, loadReviewSheet, publishClass, sendBack, verifySheets } from "./client";
import { SheetGrid, draftOf, sentText } from "./MarkSheetScreen";
import { STATUS_LABEL, className, type MarkSheet, type ReviewBoard } from "./model";
import styles from "./results.module.css";

type Flash = { tone: "ok" | "bad"; text: string } | null;

/**
 * The Co-ordinator's results inbox (source 6.3) for one terminal: each class, each subject's sheet and its teacher,
 * verify one or many, and publish a class once every subject is verified. Publish says which subject holds it up.
 */
export function ReviewBoardScreen() {
  const { api } = useSession();
  const [terminalId, setTerminalId] = useState<string | undefined>(undefined);
  const loadNow = useCallback(async () => {
    const result = await loadBoard(api, terminalId);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, terminalId]);
  const { view, reload } = useLoad<ReviewBoard>(loadNow);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  async function verify() {
    setBusy("verify");
    setFlash(null);
    const sent = await verifySheets(api, [...chosen]);
    setBusy(null);
    if (sent.ok) {
      setFlash({
        tone: "ok",
        text: t("results.review.verified", {
          count: (sent.data as { verified: number }).verified,
        }),
      });
      setChosen(new Set());
      await reload();
    } else setFlash({ tone: "bad", text: sentText(sent)! });
  }

  async function publish(classId: string, board: ReviewBoard) {
    if (!board.terminalId) return;
    setBusy(classId);
    setFlash(null);
    const sent = await publishClass(api, classId, board.terminalId);
    setBusy(null);
    setFlash(
      sent.ok
        ? {
            tone: "ok",
            text: t("results.review.published", {
              count: (sent.data as { cards: number }).cards,
            }),
          }
        : { tone: "bad", text: sentText(sent)! },
    );
    await reload();
  }

  return (
    <>
      <h1 className={setupStyles.title}>{t("results.review.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(board) =>
          board.terminals.length === 0 ? (
            <p className={setupStyles.empty}>{t("results.mine.noTerminals")}</p>
          ) : (
            <>
              <Select
                label={t("results.terminal")}
                value={board.terminalId ?? ""}
                onChange={(event) => setTerminalId(event.target.value)}
                options={board.terminals.map((x) => ({
                  value: x.id,
                  label: x.name,
                }))}
              />
              {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
              {board.classes.length === 0 ? (
                <p className={setupStyles.empty}>{t("results.review.empty")}</p>
              ) : (
                <>
                  <ul className={setupStyles.list}>
                    {board.classes.map((cls) => {
                      const holding = cls.subjects.filter((s) => s.status !== "verified" && s.status !== "published");
                      return (
                        <li key={cls.classId} className={setupStyles.item}>
                          <h2 className={setupStyles.itemTitle}>{className(cls)}</h2>
                          <div className={setupStyles.badges}>
                            {cls.published ? <Badge tone="ok">{t("results.status.published")}</Badge> : null}
                            {cls.gradingPolicy ? null : <Badge tone="bad">{t("results.review.noPolicy")}</Badge>}
                          </div>
                          <ul className={styles.list}>
                            {cls.subjects.map((s) => (
                              <li key={s.offeringId} className={styles.row}>
                                {s.status === "under_review" ? (
                                  <Checkbox
                                    label={s.subjectName}
                                    hint={s.teacherName ?? t("results.review.noTeacher")}
                                    checked={s.sheetId !== null && chosen.has(s.sheetId)}
                                    onChange={(event) => {
                                      const next = new Set(chosen);
                                      if (event.target.checked) next.add(s.sheetId!);
                                      else next.delete(s.sheetId!);
                                      setChosen(next);
                                    }}
                                  />
                                ) : (
                                  <span>
                                    {s.subjectName}
                                    <br />
                                    <span className={styles.meta}>{s.teacherName ?? t("results.review.noTeacher")}</span>
                                  </span>
                                )}
                                <span className={styles.state}>
                                  <Badge>{t(STATUS_LABEL[s.status])}</Badge>
                                  {s.missing > 0 && !cls.published ? (
                                    <span className={styles.meta}>
                                      {t("results.grid.missing", {
                                        count: s.missing,
                                      })}
                                    </span>
                                  ) : null}
                                  {s.sheetId && s.status !== "draft" ? (
                                    <Link
                                      href={`/portal/results/review?id=${s.sheetId}`}
                                      aria-label={t("results.review.openItem", {
                                        name: s.subjectName,
                                      })}
                                    >
                                      {t("results.review.open")}
                                    </Link>
                                  ) : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {cls.published ? (
                            <Link href={`/portal/results/sheets?class=${cls.classId}&terminal=${board.terminalId}`}>{t("results.review.sheet")}</Link>
                          ) : (
                            <>
                              {!cls.ready ? (
                                <p className={styles.meta}>
                                  {cls.gradingPolicy
                                    ? t("results.review.waiting", {
                                        subjects: holding.map((s) => `${s.subjectName} (${t(STATUS_LABEL[s.status])})`).join(", ") || t("results.review.marksMissing"),
                                      })
                                    : t("results.review.needsPolicy")}
                                </p>
                              ) : null}
                              <div className={styles.actions}>
                                <Button
                                  className={styles.wrapLabel}
                                  variant="secondary"
                                  disabled={!cls.ready || busy !== null}
                                  loading={busy === cls.classId}
                                  loadingLabel={t("results.saving")}
                                  onClick={() => void publish(cls.classId, board)}
                                >
                                  {t("results.review.publish")}
                                </Button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {board.classes.some((c) => c.subjects.some((s) => s.status === "under_review")) ? (
                    <div className={styles.actions}>
                      <Button className={styles.wrapLabel} disabled={chosen.size === 0 || busy !== null} loading={busy === "verify"} loadingLabel={t("results.saving")} onClick={() => void verify()}>
                        {t("results.review.verify", { count: chosen.size })}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )
        }
      </Gate>
    </>
  );
}

/** One sheet for the Co-ordinator to check (`?id=`): the marks read-only, verify, or send back with a note. */
export function ReviewSheetScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = useMemo(() => new URLSearchParams(search ?? "").get("id") ?? "", [search]);
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadReviewSheet(api, id);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id]);
  const { view, reload } = useLoad<MarkSheet>(loadNow);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);

  async function run(action: "verify" | "back") {
    setBusy(true);
    setFlash(null);
    const sent = action === "verify" ? await verifySheets(api, [id]) : await sendBack(api, id, note.trim());
    setBusy(false);
    if (sent.ok) {
      setFlash({
        tone: "ok",
        text: t(action === "verify" ? "results.review.verifiedOne" : "results.review.sentBack"),
      });
      setSending(false);
      setNote("");
      await reload();
    } else setFlash({ tone: "bad", text: sentText(sent)! });
  }

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(sheet) => (
        <>
          <h1 className={setupStyles.title}>{sheet.subjectName}</h1>
          <p className={styles.meta}>
            {className(sheet)} · {sheet.terminal.name} · {sheet.teacherName ?? t("results.review.noTeacher")}
          </p>
          <div className={styles.actions}>
            <Badge>{t(STATUS_LABEL[sheet.status])}</Badge>
          </div>
          <SheetGrid sheet={sheet} draft={draftOf(sheet)} editable={false} />
          {sheet.status === "under_review" || sheet.status === "verified" ? (
            sending ? (
              <>
                <Field label={t("results.review.note")} hint={t("results.review.noteHint")} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
                <div className={styles.actions}>
                  <Button className={styles.wrapLabel} variant="secondary" disabled={note.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void run("back")}>
                    {t("results.review.sendBack")}
                  </Button>
                  <Button className={styles.wrapLabel} variant="quiet" onClick={() => setSending(false)}>
                    {t("results.cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <div className={styles.actions}>
                {sheet.status === "under_review" ? (
                  <Button className={styles.wrapLabel} disabled={busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void run("verify")}>
                    {t("results.review.verifyOne")}
                  </Button>
                ) : null}
                <Button className={styles.wrapLabel} variant="quiet" onClick={() => setSending(true)}>
                  {t("results.review.sendBack")}
                </Button>
              </div>
            )
          ) : null}
          {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
          <p>
            <Link href="/portal/results">{t("results.review.back")}</Link>
          </p>
        </>
      )}
    </Gate>
  );
}
