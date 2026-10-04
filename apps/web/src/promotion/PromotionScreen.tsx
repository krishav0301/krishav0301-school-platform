"use client";

import { ArrowUpRight, GraduationCap, Hourglass, Wallet } from "lucide-react";
import { useCallback, useState } from "react";

import { nprShort } from "@/fees/ReadFees";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice, Select } from "@/ui";

import { loadBoard, moveStudents, type Board, type Move, type MoveResult } from "./client";
import styles from "./promotion.module.css";

type BoardClass = Board["classes"][number];
type BoardStudent = BoardClass["students"][number];

const OUTCOME: Record<BoardStudent["outcome"], { key: MessageKey; tone: "neutral" | "ok" | "warn" }> = {
  pending: { key: "promotion.outcome.pending", tone: "warn" },
  promoted: { key: "promotion.outcome.promoted", tone: "ok" },
  repeated: { key: "promotion.outcome.repeated", tone: "ok" },
  left: { key: "promotion.outcome.left", tone: "neutral" },
  graduated: { key: "promotion.outcome.graduated", tone: "ok" },
};

/** "promote:<class>", "repeat:<class>", "leave" or "graduate": one choice per student. */
export function choices(cls: BoardClass, targets: Board["targets"]): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  if (cls.nextLevelId) for (const x of targets.filter((x) => x.levelId === cls.nextLevelId)) options.push({ value: `promote:${x.classId}`, label: t("promotion.promoteTo", { className: x.className, term: x.termLabel }) });
  for (const x of targets.filter((x) => x.levelId === cls.levelId)) options.push({ value: `repeat:${x.classId}`, label: t("promotion.repeatIn", { className: x.className, term: x.termLabel }) });
  if (!cls.nextLevelId) options.push({ value: "graduate", label: t("promotion.graduate") });
  options.push({ value: "leave", label: t("promotion.leave") });
  return options;
}

/** What is proposed (D-109): promote into the first class of the next level; graduate at the last level. */
export const proposed = (cls: BoardClass, targets: Board["targets"]): string => choices(cls, targets)[0]?.value ?? "leave";

export const toMove = (enrollmentId: string, choice: string): Move => {
  const [action, classId] = choice.split(":") as [Move["action"], string | undefined];
  return classId ? { enrollmentId, action, classId } : { enrollmentId, action };
};

/** The board's figures: still to move, moved on, left or graduated, and owing. Pure. */
export function promotionFigures(board: Board): Figure[] {
  const students = board.classes.flatMap((c) => c.students);
  const n = (f: (s: BoardStudent) => boolean) => String(students.filter(f).length);
  return [
    { key: "pending", icon: Hourglass, tone: "warn", value: n((s) => s.outcome === "pending"), label: t("promotion.figure.pending") },
    { key: "moved", icon: ArrowUpRight, tone: "ok", value: n((s) => s.outcome === "promoted" || s.outcome === "repeated"), label: t("promotion.figure.moved") },
    { key: "done", icon: GraduationCap, tone: "accent", value: n((s) => s.outcome === "left" || s.outcome === "graduated"), label: t("promotion.figure.done") },
    { key: "owing", icon: Wallet, tone: "bad", value: n((s) => s.outcome === "pending" && s.balancePaisa > 0), label: t("promotion.figure.owing") },
  ];
}

const REASON: Record<NonNullable<MoveResult["reason"]>, MessageKey> = {
  not_found: "promotion.error.notFound",
  invalid: "promotion.error.invalid",
  already_moved: "promotion.error.alreadyMoved",
  has_dues: "promotion.error.hasDues",
  conflict: "promotion.error.conflict",
};

/** One class of the closed term: each student, what they owe, and where they go; one button moves the class. */
function ClassPanel({ cls, targets, onMoved }: { cls: BoardClass; targets: Board["targets"]; onMoved: (problems: string[]) => void }) {
  const { api } = useSession();
  const options = choices(cls, targets);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = cls.students.filter((s) => s.outcome === "pending");
  const choiceOf = (s: BoardStudent) => picked[s.enrollmentId] ?? proposed(cls, targets);

  async function move() {
    setBusy(true);
    const results = await moveStudents(
      api,
      pending.map((s) => toMove(s.enrollmentId, choiceOf(s))),
    );
    setBusy(false);
    if (!results) return onMoved([t("promotion.error.failed")]);
    const names = new Map(cls.students.map((s) => [s.enrollmentId, s.name]));
    onMoved(results.filter((r) => !r.ok).map((r) => t("promotion.problem", { name: names.get(r.enrollmentId) ?? "", reason: r.message ?? t(REASON[r.reason ?? "invalid"]) })));
  }

  return (
    <Panel
      title={cls.className}
      actions={
        pending.length > 0 ? (
          <Button onClick={() => void move()} loading={busy} loadingLabel={t("promotion.moving")}>
            {pending.length === 1 ? t("promotion.moveOne") : t("promotion.move", { count: pending.length })}
          </Button>
        ) : null
      }
    >
      <p className={readStyles.rowMeta}>{cls.nextLevelName ? t("promotion.nextLevel", { level: cls.nextLevelName }) : t("promotion.lastLevel")}</p>
      <ReadTable
        caption={cls.className}
        rows={cls.students}
        rowKey={(s) => s.enrollmentId}
        columns={[
          { key: "name", label: t("promotion.col.student"), primary: true, cell: (s) => `${s.name} · ${s.sid}` },
          { key: "owed", label: t("promotion.col.owed"), align: "end", cell: (s) => (s.balancePaisa > 0 ? nprShort(s.balancePaisa) : t("promotion.nothingOwed")) },
          {
            key: "move",
            label: t("promotion.col.move"),
            cell: (s) =>
              s.outcome === "pending" ? (
                <Select
                  className={styles.moveSelect}
                  label={t("promotion.moveNamed", { name: s.name })}
                  value={choiceOf(s)}
                  onChange={(event) => setPicked((p) => ({ ...p, [s.enrollmentId]: event.target.value }))}
                  options={options}
                />
              ) : (
                (s.movedTo ?? "—")
              ),
          },
          { key: "status", label: t("promotion.col.status"), plain: true, cell: (s) => <StatusWord tone={OUTCOME[s.outcome].tone}>{t(OUTCOME[s.outcome].key)}</StatusWord> },
        ]}
      />
    </Panel>
  );
}

/**
 * Moving students on (D-109, D-110): after the Principal closes a term, the Co-ordinator moves each of its students into
 * the next term. Promote is proposed; Repeat, Leaving and (at the last level) Graduated are a choice away. What a student
 * owes goes with them; leaving or graduating needs nothing owed.
 */
export function PromotionScreen() {
  const { api } = useSession();
  const [termId, setTermId] = useState<string | null>(null);
  const loadNow = useCallback(() => loadBoard(api, termId), [api, termId]);
  const { view, reload } = useLoad(loadNow);
  const [problems, setProblems] = useState<string[] | null>(null);
  const board = view.status === "ready" ? view.data : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("promotion.title")} subtitle={t("promotion.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {problems ? problems.length === 0 ? <Notice tone="ok">{t("promotion.done")}</Notice> : <Notice tone="bad">{problems.join(" ")}</Notice> : null}
      {board ? (
        board.termId === null ? (
          <EmptyLine>{t("promotion.none")}</EmptyLine>
        ) : (
          <>
            {board.terms.length > 1 ? (
              <div className={readStyles.search}>
                <Select
                  label={t("promotion.term")}
                  value={board.termId}
                  onChange={(event) => {
                    setProblems(null);
                    setTermId(event.target.value);
                  }}
                  options={board.terms.map((x) => ({ value: x.id, label: x.pending ? t("promotion.termPending", { term: x.label }) : x.label }))}
                />
              </div>
            ) : null}
            <FigureTiles figures={promotionFigures(board)} label={t("promotion.figures")} />
            {board.targets.length === 0 ? <Notice>{t("promotion.noTargets")}</Notice> : null}
            {board.classes.length === 0 ? <EmptyLine>{t("promotion.noClasses")}</EmptyLine> : null}
            {board.classes.map((cls) => (
              <ClassPanel
                key={cls.classId}
                cls={cls}
                targets={board.targets}
                onMoved={(list) => {
                  setProblems(list);
                  void reload();
                }}
              />
            ))}
          </>
        )
      ) : null}
    </div>
  );
}
