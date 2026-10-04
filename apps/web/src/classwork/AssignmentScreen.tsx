"use client";

import { CircleCheck, ClipboardCheck, NotebookPen, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { decideResubmission, gateFailure, loadAssignment, reviewWork, withdrawAssignment, type Sent } from "./client";
import { Deadline, sentMessage } from "./HomeworkScreen";
import { SUBMISSION_STATUS, className, type AssignmentDetail } from "./model";

type Student = AssignmentDetail["students"][number];

/** One piece of work at a glance: handed in, to review, reviewed, asking to resubmit. Pure. */
export function assignmentFigures(a: AssignmentDetail): Figure[] {
  const sent = a.students.filter((s) => s.submission !== null);
  const count = (status: NonNullable<Student["submission"]>["status"]) => sent.filter((s) => s.submission!.status === status).length;
  return [
    { key: "in", icon: NotebookPen, tone: "accent", value: t("coord.ofTotal", { done: sent.length, total: a.students.length }), label: t("classwork.work.figure.handedIn") },
    { key: "review", icon: ClipboardCheck, tone: count("submitted") > 0 ? "warn" : "ok", value: String(count("submitted")), label: t("classwork.work.figure.review") },
    { key: "reviewed", icon: CircleCheck, tone: "ok", value: String(count("reviewed")), label: t("classwork.work.figure.reviewed") },
    { key: "requests", icon: Undo2, tone: count("resubmit_requested") > 0 ? "warn" : "ok", value: String(count("resubmit_requested")), label: t("classwork.work.figure.requests") },
  ];
}

/** Where a student's answer stands, in words. */
function answerState(s: Student): { tone: "ok" | "warn" | undefined; text: string } {
  if (s.submission === null) return { tone: undefined, text: t("classwork.work.notSubmitted") };
  if (s.submission.status === "submitted") return { tone: "warn", text: t("classwork.work.status.toReview") };
  return { tone: s.submission.status === "reviewed" ? "ok" : "warn", text: t(SUBMISSION_STATUS[s.submission.status]) };
}

/** Every student, what needs the teacher first, each answer opening in a side panel. Pure. */
export function AnswerList({ students, onOpen }: { students: readonly Student[]; onOpen?: (s: Student) => void }) {
  if (students.length === 0) return <EmptyLine>{t("attendance.register.empty")}</EmptyLine>;
  const rank = (s: Student) => (s.submission === null ? 3 : s.submission.status === "submitted" || s.submission.status === "resubmit_requested" ? 0 : s.submission.status === "reviewed" ? 2 : 1);
  const ordered = [...students].sort((a, b) => rank(a) - rank(b));
  return (
    <ul className={readStyles.rows}>
      {ordered.map((s) => {
        const state = answerState(s);
        return (
          <li key={s.enrollmentId} className={readStyles.rowItem}>
            <div className={readStyles.rowHead}>
              <h3 className={readStyles.rowTitle}>{s.name}</h3>
              <span className={readStyles.cellWords}>
                <StatusWord tone={state.tone}>{state.text}</StatusWord>
                {s.submission?.isLate ? <StatusWord tone="bad">{t("classwork.work.late")}</StatusWord> : null}
              </span>
            </div>
            <div className={readStyles.rowHead}>
              <p className={readStyles.rowMeta}>{s.sid}</p>
              {s.submission !== null && onOpen ? (
                <Button variant="quiet" className={styles.wrapLabel} onClick={() => onOpen(s)} aria-label={t("classwork.work.openAnswer", { name: s.name })}>
                  {t(s.submission.status === "submitted" ? "dashboard.homework.review" : "dashboard.open")}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** One assignment for its teacher (`?id=`; redesigned in D-107): the figures, the instructions, and every student's answer. */
export function AssignmentScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadAssignment(api, id);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id]);
  const { view, reload } = useLoad<AssignmentDetail>(loadNow);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const a = view.status === "ready" ? view.data : null;
  const open = a?.students.find((s) => s.enrollmentId === openId) ?? null;

  async function withdraw() {
    if (!a) return;
    setBusy(true);
    const sent = await withdrawAssignment(api, a.id);
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: t("classwork.work.withdrawn") });
      void reload();
    } else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={a?.title ?? t("classwork.work.title")}
        subtitle={a ? `${a.subjectName} · ${className(a)}` : undefined}
        crumbs={[{ label: t("classwork.work.title"), href: "/portal/classwork/homework" }, { label: a?.title ?? "" }]}
        actions={
          a && !a.withdrawn ? (
            <Button variant="quiet" className={styles.wrapLabel} onClick={() => void withdraw()} loading={busy} loadingLabel={t("classwork.saving")}>
              {t("classwork.work.withdraw")}
            </Button>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {a ? (
        <>
          <FigureTiles figures={assignmentFigures(a)} label={t("classwork.work.figures")} />
          <Panel title={t("classwork.work.instructions")} labelledBy="work-instructions" actions={a.withdrawn ? <StatusWord>{t("classwork.withdrawn")}</StatusWord> : null}>
            <p className={readStyles.rowMeta}>
              <Deadline dueAt={a.dueAt} dueDateBs={a.dueDateBs} />
              {a.maxMarks !== null ? ` · ${t("classwork.work.marksLabel", { max: a.maxMarks })}` : ""}
            </p>
            <p className={styles.body}>{a.instructions}</p>
            {a.link ? (
              <p>
                <a href={a.link} target="_blank" rel="noopener noreferrer">
                  {t("classwork.notes.openLink")}
                </a>
              </p>
            ) : null}
          </Panel>
          <Panel title={t("classwork.work.answers")} labelledBy="work-answers">
            <AnswerList students={a.students} onOpen={(s) => setOpenId(s.enrollmentId)} />
          </Panel>
        </>
      ) : null}
      {a && open?.submission ? (
        <ReviewPanel
          key={open.submission.id}
          assignment={a}
          student={open}
          onClose={() => setOpenId(null)}
          onDone={(text) => {
            setOpenId(null);
            setMessage({ tone: "ok", text });
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** One student's answer in a side panel: what they wrote, then the review or the resubmission decision. */
function ReviewPanel({ assignment, student, onClose, onDone }: { assignment: AssignmentDetail; student: Student; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const submission = student.submission!;
  const [marks, setMarks] = useState(submission.marks?.toString() ?? "");
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = answerState(student);
  const reviewing = submission.status === "submitted" || submission.status === "reviewed";

  async function run(action: () => Promise<Sent>, done: string) {
    setBusy(true);
    const sent = await action();
    setBusy(false);
    if (sent.ok) onDone(done);
    else setError(sentMessage(sent));
  }

  const parsedMarks = Number.parseInt(marks, 10);
  const reviewBody = { ...(assignment.maxMarks !== null && Number.isFinite(parsedMarks) ? { marks: parsedMarks } : {}), ...(feedback.trim() ? { feedback: feedback.trim() } : {}) };

  return (
    <SidePanel
      title={student.name}
      subtitle={student.sid}
      status={<StatusWord tone={state.tone}>{state.text}</StatusWord>}
      busy={busy}
      onClose={onClose}
      foot={
        reviewing ? (
          <Button fullWidth onClick={() => void run(() => reviewWork(api, assignment.id, submission.id, reviewBody), t("classwork.work.reviewSaved", { name: student.name }))} loading={busy} loadingLabel={t("classwork.saving")} disabled={busy || Object.keys(reviewBody).length === 0}>
            {t("classwork.work.saveReview")}
          </Button>
        ) : submission.status === "resubmit_requested" ? (
          <div className={styles.rowActions}>
            <Button className={styles.wrapLabel} variant="quiet" onClick={() => void run(() => decideResubmission(api, assignment.id, submission.id, false), t("classwork.work.declined", { name: student.name }))} disabled={busy}>
              {t("classwork.work.decline")}
            </Button>
            <Button className={styles.wrapLabel} onClick={() => void run(() => decideResubmission(api, assignment.id, submission.id, true), t("classwork.work.allowed", { name: student.name }))} loading={busy} loadingLabel={t("classwork.saving")}>
              {t("classwork.work.allow")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className={styles.form}>
        {submission.isLate ? (
          <p>
            <StatusWord tone="bad">{t("classwork.work.late")}</StatusWord>
          </p>
        ) : null}
        <div>
          <p className={styles.meta}>{t("classwork.work.theirAnswer")}</p>
          <p className={styles.body}>{submission.body}</p>
        </div>
        {submission.status === "resubmit_requested" ? <p>{t("classwork.work.requestReason", { reason: submission.resubmitReason ?? "" })}</p> : null}
        {reviewing ? (
          <>
            {assignment.maxMarks !== null ? <Field label={t("classwork.work.marksLabel", { max: assignment.maxMarks })} inputMode="numeric" maxLength={4} value={marks} onChange={(event) => setMarks(event.target.value)} /> : null}
            <TextArea label={t("classwork.work.feedback")} rows={5} maxLength={2000} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          </>
        ) : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </SidePanel>
  );
}
