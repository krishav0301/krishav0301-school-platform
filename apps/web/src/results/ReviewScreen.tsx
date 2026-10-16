"use client";

import { BookOpen, CheckCheck, ChevronDown, ClipboardCheck, Hourglass, School } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";

import classStyles from "@/classes/classes.module.css";
import { bareSection, sectionBadge } from "@/classes/model";
import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import accessStyles from "@/people/people-access.module.css";
import { EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Checkbox, Field, Notice, Select } from "@/ui";

import { gateFailure, loadBoard, loadReviewSheet, publishClass, sendBack, verifySheets } from "./client";
import { SheetGrid, draftOf, sentText } from "./MarkSheetScreen";
import { STATUS_LABEL, className, type MarkSheet, type ReviewBoard, type SheetStatus } from "./model";
import styles from "./results.module.css";

type Flash = { tone: "ok" | "bad"; text: string } | null;
type BoardClass = ReviewBoard["classes"][number];
type BoardSubject = BoardClass["subjects"][number];

/** A sheet's state in words, in the theme's status colours: waiting on the Co-ordinator is the one to notice. */
export const statusTone = (status: SheetStatus): "ok" | "warn" | undefined => (status === "under_review" ? "warn" : status === "verified" || status === "published" ? "ok" : undefined);

/** Four figures for the terminal: its classes, subjects waiting to be verified, subjects verified, classes published. Pure. */
export function boardFigures(board: ReviewBoard): Figure[] {
  const subjects = board.classes.flatMap((c) => c.subjects);
  return [
    { key: "classes", icon: School, tone: "accent", value: String(board.classes.length), label: t("results.review.figure.classes") },
    { key: "waiting", icon: Hourglass, tone: "warn", value: String(subjects.filter((s) => s.status === "under_review").length), label: t("results.review.figure.waiting") },
    { key: "verified", icon: ClipboardCheck, tone: "ok", value: String(subjects.filter((s) => s.status === "verified").length), label: t("results.review.figure.verified") },
    { key: "published", icon: CheckCheck, tone: "ok", value: String(board.classes.filter((c) => c.published).length), label: t("results.review.figure.published") },
  ];
}

/** Where a class stands, in words: published (with the final result, when it is out), ready to publish, or waiting for marks. */
export function classState(cls: BoardClass): { tone: "ok" | "warn" | "bad" | undefined; key: "results.status.published" | "results.review.finalOut" | "results.review.ready" | "results.review.inProgress" } {
  if (cls.published) return { tone: "ok", key: cls.finalPublished ? "results.review.finalOut" : "results.status.published" };
  if (cls.ready) return { tone: "ok", key: "results.review.ready" };
  return { tone: "warn", key: "results.review.inProgress" };
}

/** A course of the board, as on the Classes page: its levels, each with its classes, and the counts its card shows. */
export type BoardCourse = { name: string; levels: { name: string; classes: BoardClass[] }[]; classes: number; waiting: number; published: number };

/** The board's classes grouped by course, then level, in the order the server sent them (course, level, section). Pure. */
export function groupBoard(classes: readonly BoardClass[]): BoardCourse[] {
  const courses: BoardCourse[] = [];
  for (const c of classes) {
    let course = courses.find((g) => g.name === c.programmeName);
    if (!course) courses.push((course = { name: c.programmeName, levels: [], classes: 0, waiting: 0, published: 0 }));
    let level = course.levels.find((l) => l.name === c.levelName);
    if (!level) course.levels.push((level = { name: c.levelName, classes: [] }));
    level.classes.push(c);
    course.classes += 1;
    course.waiting += c.subjects.filter((s) => s.status === "under_review").length;
    if (c.published) course.published += 1;
  }
  return courses;
}

/** Each course card's soft tint, in turn, from the theme's tones (as on the Classes page). */
const TONES = ["primary", "ok", "accent", "warn"] as const;

const sectionName = (cls: BoardClass): string => (cls.label ? t("classes.section", { name: bareSection(cls.label) }) : t("classes.noSection"));

/**
 * One class of the board, laid out like a section on the Classes page: its badge and name, its state in words, how many
 * subjects are verified, and a button that opens its subjects: a box to choose each sheet that is waiting, and Publish
 * once every subject is verified. Pure apart from the open state.
 */
export function BoardClassPanel({
  cls,
  terminalId,
  chosen,
  busy,
  onChoose,
  onPublish,
  startOpen,
}: {
  cls: BoardClass;
  terminalId: string | null;
  chosen: ReadonlySet<string>;
  busy: string | null;
  onChoose: (sheetId: string, on: boolean) => void;
  onPublish: () => void;
  startOpen?: boolean;
}) {
  const state = classState(cls);
  const holding = cls.subjects.filter((s) => s.status !== "verified" && s.status !== "published");
  const done = cls.subjects.length - holding.length;
  const bodyId = useId();
  const [open, setOpen] = useState(startOpen ?? false);
  const name = className(cls);
  return (
    <li className={styles.sectionItem}>
      <div className={classStyles.section}>
        <span className={classStyles.badge} aria-hidden>
          {sectionBadge(cls.label)}
        </span>
        <span className={classStyles.sectionName}>{sectionName(cls)}</span>
        <span className={classStyles.teacher}>
          <StatusWord tone={state.tone}>{t(state.key)}</StatusWord>
        </span>
        <span className={classStyles.students}>{t("results.review.verifiedOf", { done, total: cls.subjects.length })}</span>
        <button type="button" className={classStyles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "classes.hide" : "classes.show", { name })} onClick={() => setOpen(!open)}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={styles.sectionBody}>
          <ReadTable
            caption={name}
            rows={cls.subjects}
            rowKey={(s) => s.offeringId}
            columns={[
              {
                key: "subject",
                label: t("results.review.col.subject"),
                primary: true,
                cell: (s: BoardSubject) =>
                  s.status === "under_review" && s.sheetId ? (
                    <Checkbox label={s.subjectName} checked={chosen.has(s.sheetId)} onChange={(event) => onChoose(s.sheetId!, event.target.checked)} />
                  ) : (
                    s.subjectName
                  ),
              },
              { key: "teacher", label: t("results.review.col.teacher"), cell: (s) => s.teacherName ?? t("results.review.noTeacher") },
              {
                key: "status",
                label: t("attendance.class.status"),
                cell: (s) => (
                  <span className={readStyles.cellWords}>
                    <StatusWord tone={statusTone(s.status)}>{t(STATUS_LABEL[s.status])}</StatusWord>
                    {s.missing > 0 && !cls.published ? <span className={readStyles.rowMeta}>{t("results.grid.missing", { count: s.missing })}</span> : null}
                  </span>
                ),
              },
              {
                key: "open",
                label: t("results.review.open"),
                align: "end",
                plain: true,
                cell: (s) => (s.sheetId && s.status !== "draft" ? <OpenLink href={`/portal/results/review?id=${s.sheetId}`} label={t("results.review.openItem", { name: s.subjectName })} /> : null),
              },
            ]}
          />
          {cls.published ? (
            <div className={readStyles.cellWords}>
              <OpenLink href={`/portal/results/sheets?class=${cls.classId}&terminal=${terminalId ?? ""}`} label={t("results.review.sheet")} text={t("results.review.sheet")} />
              {cls.finalPublished ? <OpenLink href={`/portal/results/sheets?class=${cls.classId}&terminal=final`} label={t("results.review.finalSheet")} text={t("results.review.finalSheet")} /> : null}
            </div>
          ) : (
            <div className={styles.publishRow}>
              {!cls.ready ? (
                <p className={readStyles.rowMeta}>
                  {t("results.review.waiting", { subjects: holding.map((s) => `${s.subjectName} (${t(STATUS_LABEL[s.status])})`).join(", ") || t("results.review.marksMissing") })}
                </p>
              ) : (
                <p className={readStyles.rowMeta}>{t("results.review.readyLine")}</p>
              )}
              <Button className={styles.wrapLabel} variant="secondary" disabled={!cls.ready || busy !== null} loading={busy === cls.classId} loadingLabel={t("results.saving")} onClick={onPublish}>
                {t("results.review.publish")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** One course of the board as a card, like the Classes page: its counts in the head, its levels inside when open. */
export function BoardCourseCard({ course, tone, open, onToggle, children }: { course: BoardCourse; tone: string; open: boolean; onToggle: () => void; children: (level: BoardCourse["levels"][number]) => React.ReactNode }) {
  const bodyId = useId();
  return (
    <li className={classStyles.course} data-tone={tone}>
      <div className={classStyles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          <BookOpen />
        </span>
        <div className={classStyles.courseName}>
          <h2 className={classStyles.courseTitle}>{course.name}</h2>
        </div>
        <dl className={classStyles.stats}>
          <div>
            <dt>{t("results.review.figure.classes")}</dt>
            <dd>{course.classes}</dd>
          </div>
          <div>
            <dt>{t("results.review.stat.waiting")}</dt>
            <dd>{course.waiting}</dd>
          </div>
          <div>
            <dt>{t("results.review.figure.published")}</dt>
            <dd>{course.published}</dd>
          </div>
        </dl>
        <button type="button" className={classStyles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "classes.hide" : "classes.show", { name: course.name })} onClick={onToggle}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={classStyles.levels}>
          {course.levels.map((level) => (
            <section key={level.name} className={classStyles.level} aria-label={level.name}>
              <div className={classStyles.levelHead}>
                <h3 className={classStyles.levelTitle}>{level.name}</h3>
                <span className={classStyles.levelCounts}>{t(level.classes.length === 1 ? "classes.sectionsOne" : "classes.sectionsMany", { n: level.classes.length })}</span>
              </div>
              <ul className={classStyles.sections}>{children(level)}</ul>
            </section>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The Co-ordinator's results inbox (source 6.3) for one terminal, redesigned in D-106: four figures, each class in its
 * own card, verify one or many with one button, and publish a class once every subject is verified.
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
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const board = view.status === "ready" ? view.data : null;

  async function verify() {
    setBusy("verify");
    setFlash(null);
    const sent = await verifySheets(api, [...chosen]);
    setBusy(null);
    if (sent.ok) {
      setFlash({ tone: "ok", text: t("results.review.verified", { count: (sent.data as { verified: number }).verified }) });
      setChosen(new Set());
      await reload();
    } else setFlash({ tone: "bad", text: sentText(sent)! });
  }

  async function publish(classId: string) {
    if (!board?.terminalId) return;
    setBusy(classId);
    setFlash(null);
    const sent = await publishClass(api, classId, board.terminalId);
    setBusy(null);
    setFlash(sent.ok ? { tone: "ok", text: t("results.review.published", { count: (sent.data as { cards: number }).cards }) } : { tone: "bad", text: sentText(sent)! });
    await reload();
  }

  const waiting = board ? board.classes.some((c) => c.subjects.some((s) => s.status === "under_review")) : false;

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("results.review.title")} subtitle={t("results.review.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={8} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {board ? (
        board.terminals.length === 0 ? (
          <EmptyLine>{t("results.mine.noTerminals")}</EmptyLine>
        ) : (
          <>
            <div className={readStyles.search}>
              <Select
                label={t("results.terminal")}
                value={board.terminalId ?? ""}
                onChange={(event) => {
                  setTerminalId(event.target.value);
                  setChosen(new Set());
                  setFlash(null);
                }}
                options={board.terminals.map((x) => ({ value: x.id, label: x.name }))}
              />
            </div>
            {board.classes.length > 0 ? <FigureTiles figures={boardFigures(board)} label={t("results.review.figures")} /> : null}
            {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
            {board.classes.length === 0 ? (
              <EmptyLine>{t("results.review.empty")}</EmptyLine>
            ) : (
              <ul className={classStyles.courses}>
                {groupBoard(board.classes).map((course, i) => {
                  // A course with sheets waiting for the Co-ordinator starts open; the rest start closed, as on Classes.
                  const isOpen = toggled[course.name] ?? course.waiting > 0;
                  return (
                    <BoardCourseCard key={course.name} course={course} tone={TONES[i % TONES.length]!} open={isOpen} onToggle={() => setToggled((now) => ({ ...now, [course.name]: !isOpen }))}>
                      {(level) =>
                        level.classes.map((cls) => (
                          <BoardClassPanel
                            key={cls.classId}
                            cls={cls}
                            terminalId={board.terminalId}
                            chosen={chosen}
                            busy={busy}
                            onChoose={(sheetId, on) => {
                              const next = new Set(chosen);
                              if (on) next.add(sheetId);
                              else next.delete(sheetId);
                              setChosen(next);
                            }}
                            onPublish={() => void publish(cls.classId)}
                          />
                        ))
                      }
                    </BoardCourseCard>
                  );
                })}
              </ul>
            )}
            {waiting ? (
              <div className={styles.verifyBar}>
                <p className={readStyles.rowMeta} aria-live="polite">
                  {t("results.review.chosen", { count: chosen.size })}
                </p>
                <Button className={styles.wrapLabel} disabled={chosen.size === 0 || busy !== null} loading={busy === "verify"} loadingLabel={t("results.saving")} onClick={() => void verify()}>
                  {t("results.review.verify", { count: chosen.size })}
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
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
      setFlash({ tone: "ok", text: t(action === "verify" ? "results.review.verifiedOne" : "results.review.sentBack") });
      setSending(false);
      setNote("");
      await reload();
    } else setFlash({ tone: "bad", text: sentText(sent)! });
  }

  if (view.status === "loading") return <TableSkeleton rows={8} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const sheet = view.data;
  const decidable = sheet.status === "under_review" || sheet.status === "verified";

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={sheet.subjectName}
        subtitle={`${className(sheet)} · ${sheet.terminal.name} · ${sheet.teacherName ?? t("results.review.noTeacher")}`}
        crumbs={[{ label: t("results.review.title"), href: "/portal/results" }, { label: sheet.subjectName }]}
        actions={<StatusWord tone={statusTone(sheet.status)}>{t(STATUS_LABEL[sheet.status])}</StatusWord>}
      />
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Panel>
        <SheetGrid sheet={sheet} draft={draftOf(sheet)} editable={false} />
      </Panel>
      {decidable ? (
        <Panel title={t(sending ? "results.review.sendBackTitle" : "results.review.decideTitle")} labelledBy="sheet-decide">
          {sending ? (
            <>
              <Field label={t("results.review.note")} hint={t("results.review.noteHint")} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
              <div className={styles.actions}>
                <Button className={styles.wrapLabel} disabled={note.trim().length < 3 || busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void run("back")}>
                  {t("results.review.sendBack")}
                </Button>
                <Button className={styles.wrapLabel} variant="quiet" onClick={() => setSending(false)}>
                  {t("results.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className={readStyles.rowMeta}>{t(sheet.status === "under_review" ? "results.review.decideHint" : "results.review.verifiedHint")}</p>
              <div className={styles.actions}>
                {sheet.status === "under_review" ? (
                  <Button className={styles.wrapLabel} disabled={busy} loading={busy} loadingLabel={t("results.saving")} onClick={() => void run("verify")}>
                    {t("results.review.verifyOne")}
                  </Button>
                ) : null}
                <Button className={styles.wrapLabel} variant={sheet.status === "under_review" ? "quiet" : "secondary"} onClick={() => setSending(true)}>
                  {t("results.review.sendBack")}
                </Button>
              </div>
            </>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
