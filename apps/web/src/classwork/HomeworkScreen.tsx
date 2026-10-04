"use client";

import { CircleCheck, ClipboardCheck, NotebookPen, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";

import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { gateFailure, loadMyToday, loadStudentAssignments, loadTeacherAssignments, requestResubmission, setAssignment, submitWork, type Sent } from "./client";
import { SUBMISSION_STATUS, className, dueInstant, nepalTime, subjectChoice, subjectKey, type StudentAssignments, type Subject, type TeacherAssignments } from "./model";

/** Homework (D-072; redesigned in D-107): a teacher sets work and follows it up; a student hands in, reads the review, asks to resubmit. */
export function HomeworkScreen() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  if (roles.includes("teacher")) return <TeacherWork />;
  if (roles.includes("student")) return <StudentWork />;
  return null;
}

export function sentMessage(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid") return sent.message;
  if (sent.reason === "closed") return t("classwork.closed");
  if (sent.reason === "refused") return t("classwork.refused");
  return t("classwork.failed");
}

/** "Due 2083-06-15, 10:00": the deadline's BS day and its Nepal time. */
export function Deadline({ dueAt, dueDateBs }: { dueAt: string; dueDateBs: string | null }) {
  return <>{t("classwork.work.due", { time: nepalTime(dueAt), date: dueDateBs ? formatBsDate(dueDateBs) : dueAt.slice(0, 10) })}</>;
}

type Set = TeacherAssignments["assignments"][number];

/** What the teacher's homework needs from them: open work, answers to review, requests to resubmit. Pure. */
export function setWorkFigures(work: TeacherAssignments): Figure[] {
  const live = work.assignments.filter((a) => !a.withdrawn);
  const review = live.reduce((n, a) => n + a.toReview, 0);
  const requests = live.reduce((n, a) => n + a.requests, 0);
  return [
    { key: "open", icon: NotebookPen, tone: "accent", value: String(live.length), label: t("classwork.work.figure.set") },
    { key: "review", icon: ClipboardCheck, tone: review > 0 ? "warn" : "ok", value: String(review), label: t("classwork.work.figure.review") },
    { key: "requests", icon: Undo2, tone: requests > 0 ? "warn" : "ok", value: String(requests), label: t("classwork.work.figure.requests") },
  ];
}

/** Where one piece of set work stands, in words. */
function setState(a: Set): { tone: "ok" | "warn" | undefined; text: string } {
  if (a.withdrawn) return { tone: undefined, text: t("classwork.withdrawn") };
  if (a.toReview > 0) return { tone: "warn", text: t("classwork.work.toReview", { count: a.toReview }) };
  if (a.requests > 0) return { tone: "warn", text: t("classwork.work.requests", { count: a.requests }) };
  return { tone: "ok", text: t("classwork.work.upToDate") };
}

/** The homework a teacher has set, what needs them first, each opening its answers. Pure. */
export function SetWorkList({ assignments }: { assignments: readonly Set[] }) {
  if (assignments.length === 0) return <EmptyLine>{t("classwork.work.noneSet")}</EmptyLine>;
  const needs = (a: Set) => !a.withdrawn && a.toReview + a.requests > 0;
  const ordered = [...assignments.filter(needs), ...assignments.filter((a) => !needs(a) && !a.withdrawn), ...assignments.filter((a) => a.withdrawn)];
  return (
    <ul className={readStyles.rows}>
      {ordered.map((a) => {
        const state = setState(a);
        return (
          <li key={a.id} className={readStyles.rowItem}>
            <div className={readStyles.rowHead}>
              <h3 className={readStyles.rowTitle}>{a.title}</h3>
              <StatusWord tone={state.tone}>{state.text}</StatusWord>
            </div>
            <p className={readStyles.rowMeta}>
              {a.subjectName} · {className(a)} · <Deadline dueAt={a.dueAt} dueDateBs={a.dueDateBs} />
            </p>
            <div className={readStyles.rowHead}>
              <p className={readStyles.rowMeta}>{t("classwork.work.counts", { submitted: a.submitted, students: a.students })}</p>
              <OpenLink href={`/portal/classwork/homework/assignment?id=${a.id}`} label={t("classwork.work.openNamed", { title: a.title })} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TeacherWork() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const [subjects, work] = await Promise.all([loadMyToday(api), loadTeacherAssignments(api)]);
    if (!subjects.ok) return gateFailure(subjects.reason);
    if (!work.ok) return gateFailure(work.reason);
    return { ok: true as const, data: { subjects: subjects.data.subjects, work: work.data } };
  }, [api]);
  const { view, reload } = useLoad<{ subjects: Subject[]; work: TeacherAssignments }>(loadNow);
  const [done, setDone] = useState<string | null>(null);
  const data = view.status === "ready" ? view.data : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("classwork.work.title")}
        subtitle={t("classwork.work.teacherSubtitle")}
        actions={
          data && data.subjects.length > 0 ? (
            <AddDialog label={t("classwork.work.newTitle")} title={t("classwork.work.newTitle")}>
              {(close) => (
                <SetWorkForm
                  subjects={data.subjects}
                  onSet={(title) => {
                    close();
                    setDone(t("classwork.work.setNamed", { title }));
                    void reload();
                  }}
                />
              )}
            </AddDialog>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {data ? (
        <>
          {data.subjects.length === 0 ? <ReadOnlyNote>{t("classwork.activity.noSubjects")}</ReadOnlyNote> : null}
          {data.work.assignments.length > 0 ? <FigureTiles figures={setWorkFigures(data.work)} label={t("classwork.work.figures")} /> : null}
          <Panel title={t("classwork.work.set")} labelledBy="set-work">
            <SetWorkList assignments={data.work.assignments} />
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function SetWorkForm({ subjects, onSet }: { subjects: Subject[]; onSet: (title: string) => void }) {
  const { api } = useSession();
  const [target, setTarget] = useState(subjectKey(subjects[0]!));
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [link, setLink] = useState("");
  const [dueBs, setDueBs] = useState("");
  const [dueTime, setDueTime] = useState("10:00");
  const [maxMarks, setMaxMarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const day = await toAd(api, dueBs.trim());
    if (!day.ok) {
      setBusy(false);
      return setMessage(t("classwork.work.badDay"));
    }
    const subject = subjects.find((s) => subjectKey(s) === target)!;
    const marks = Number.parseInt(maxMarks, 10);
    const sent = await setAssignment(api, {
      classId: subject.classId,
      offeringId: subject.offeringId,
      title: title.trim(),
      instructions: instructions.trim(),
      dueAt: dueInstant(day.ad, dueTime),
      ...(link.trim() ? { link: link.trim() } : {}),
      ...(Number.isFinite(marks) && marks > 0 ? { maxMarks: marks } : {}),
    });
    setBusy(false);
    if (sent.ok) onSet(title.trim());
    else setMessage(sentMessage(sent));
  }

  return (
    <div className={styles.form}>
      <Select label={t("classwork.subject")} options={subjects.map(subjectChoice)} value={target} onChange={(event) => setTarget(event.target.value)} />
      <Field label={t("classwork.work.titleLabel")} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      <TextArea label={t("classwork.work.instructions")} rows={5} maxLength={5000} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
      <BsDateField legend={t("classwork.work.dueDay")} hint={t("classwork.pickDayHint")} value={dueBs} onChange={setDueBs} />
      <Field label={t("classwork.work.dueTime")} hint={t("classwork.work.dueTimeHint")} type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
      <Field label={t("classwork.work.maxMarks")} hint={t("classwork.work.maxMarksHint")} inputMode="numeric" value={maxMarks} maxLength={4} onChange={(event) => setMaxMarks(event.target.value)} />
      <Field label={t("classwork.link")} hint={t("classwork.linkHint")} type="url" inputMode="url" value={link} maxLength={500} onChange={(event) => setLink(event.target.value)} />
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void submit()} loading={busy} loadingLabel={t("classwork.saving")} disabled={!title.trim() || !instructions.trim() || !dueBs.trim()}>
        {t("classwork.work.setButton")}
      </Button>
    </div>
  );
}

type Given = StudentAssignments["assignments"][number];
const toHandIn = (a: Given) => a.submission === null || a.submission.status === "resubmit_allowed";

/** Where a student's homework stands, in words. Pure. */
export function givenState(a: Given): { tone: "ok" | "warn" | "bad" | undefined; text: string } {
  if (a.submission === null) return { tone: "warn", text: t("classwork.work.notSubmitted") };
  return { tone: a.submission.status === "reviewed" ? "ok" : a.submission.status === "resubmit_allowed" ? "warn" : undefined, text: t(SUBMISSION_STATUS[a.submission.status]) };
}

export function givenFigures(data: StudentAssignments): Figure[] {
  const open = data.assignments.filter(toHandIn).length;
  const reviewed = data.assignments.filter((a) => a.submission?.status === "reviewed").length;
  return [
    { key: "open", icon: NotebookPen, tone: open > 0 ? "warn" : "ok", value: String(open), label: t("home.student.figure.homework") },
    { key: "in", icon: CircleCheck, tone: "ok", value: String(data.assignments.length - open), label: t("classwork.work.figure.handedIn") },
    { key: "reviewed", icon: ClipboardCheck, tone: "accent", value: String(reviewed), label: t("classwork.work.figure.reviewed") },
  ];
}

/** The student's homework, what is still to hand in first, each opening in a side panel. Pure. */
export function GivenList({ assignments, onOpen }: { assignments: readonly Given[]; onOpen?: (a: Given) => void }) {
  if (assignments.length === 0) return <EmptyLine>{t("classwork.work.noneYet")}</EmptyLine>;
  const ordered = [...assignments.filter(toHandIn), ...assignments.filter((a) => !toHandIn(a))];
  return (
    <ul className={readStyles.rows}>
      {ordered.map((a) => {
        const state = givenState(a);
        return (
          <li key={a.id} className={readStyles.rowItem}>
            <div className={readStyles.rowHead}>
              <h3 className={readStyles.rowTitle}>{a.title}</h3>
              <StatusWord tone={state.tone}>{state.text}</StatusWord>
            </div>
            <p className={readStyles.rowMeta}>
              {a.subjectName} · {a.teacherName} · <Deadline dueAt={a.dueAt} dueDateBs={a.dueDateBs} />
            </p>
            {onOpen ? (
              <div className={styles.rowActions}>
                <Button variant="quiet" className={styles.wrapLabel} onClick={() => onOpen(a)} aria-label={t(toHandIn(a) ? "classwork.work.handInNamed" : "classwork.work.openNamed", { title: a.title })}>
                  {t(toHandIn(a) ? "home.student.handIn" : "dashboard.open")}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StudentWork() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadStudentAssignments(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<StudentAssignments>(loadNow);
  const [openId, setOpenId] = useState<string | null>(null);
  const data = view.status === "ready" ? view.data : null;
  const open = data?.assignments.find((a) => a.id === openId) ?? null;
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("classwork.work.title")} subtitle={t("classwork.work.studentSubtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {data ? (
        <>
          {data.assignments.length > 0 ? <FigureTiles figures={givenFigures(data)} label={t("classwork.work.figures")} /> : null}
          <Panel title={t("classwork.work.yours")} labelledBy="your-work">
            <GivenList assignments={data.assignments} onOpen={(a) => setOpenId(a.id)} />
          </Panel>
        </>
      ) : null}
      {open ? (
        <SidePanel title={open.title} subtitle={`${open.subjectName} · ${open.teacherName}`} status={<StatusWord tone={givenState(open).tone}>{givenState(open).text}</StatusWord>} onClose={() => setOpenId(null)}>
          <StudentAssignment assignment={open} onChanged={() => void reload()} />
        </SidePanel>
      ) : null}
    </div>
  );
}

export function StudentAssignment({ assignment, onChanged }: { assignment: StudentAssignments["assignments"][number]; onChanged: () => void }) {
  const { api } = useSession();
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submission = assignment.submission;
  const canSubmit = submission === null || submission.status === "resubmit_allowed";
  const canAsk = submission !== null && (submission.status === "submitted" || submission.status === "reviewed");

  async function run(action: () => Promise<Sent>) {
    setBusy(true);
    const sent = await action();
    setBusy(false);
    if (sent.ok) {
      setError(null);
      onChanged();
    } else setError(sentMessage(sent));
  }

  return (
    <div className={styles.form}>
      <p className={styles.meta}>
        <Deadline dueAt={assignment.dueAt} dueDateBs={assignment.dueDateBs} />
      </p>
      <p className={styles.body}>{assignment.instructions}</p>
      {assignment.link ? (
        <p>
          <a href={assignment.link} target="_blank" rel="noopener noreferrer">
            {t("classwork.notes.openLink")}
          </a>
        </p>
      ) : null}
      {submission ? (
        <p className={readStyles.cellWords}>
          <StatusWord tone={submission.status === "reviewed" ? "ok" : undefined}>{t(SUBMISSION_STATUS[submission.status])}</StatusWord>
          {submission.isLate ? <StatusWord tone="bad">{t("classwork.work.late")}</StatusWord> : null}
          {submission.marks !== null && assignment.maxMarks !== null ? <StatusWord>{t("classwork.work.marks", { marks: submission.marks, max: assignment.maxMarks })}</StatusWord> : null}
        </p>
      ) : (
        <p>
          <StatusWord tone="warn">{t("classwork.work.notSubmitted")}</StatusWord>
        </p>
      )}
      {submission?.feedback ? (
        <div>
          <p className={styles.meta}>{t("classwork.work.feedback")}</p>
          <p className={styles.body}>{submission.feedback}</p>
        </div>
      ) : null}
      {submission && !canSubmit ? (
        <div>
          <p className={styles.meta}>{t("classwork.work.yourAnswer")}</p>
          <p className={styles.body}>{submission.body}</p>
        </div>
      ) : null}
      {canSubmit ? (
        <>
          <TextArea label={t("classwork.work.answer")} rows={6} maxLength={10000} value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <Button className={styles.wrapLabel} fullWidth onClick={() => void run(() => submitWork(api, assignment.id, answer.trim()))} loading={busy} loadingLabel={t("classwork.saving")} disabled={!answer.trim()}>
            {t("classwork.work.submit")}
          </Button>
        </>
      ) : null}
      {canAsk && !asking ? (
        <div className={styles.actions}>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => setAsking(true)}>
            {t("classwork.work.askResubmit")}
          </Button>
        </div>
      ) : null}
      {canAsk && asking ? (
        <>
          <Field label={t("classwork.work.resubmitReason")} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          <div className={styles.actions}>
            <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => requestResubmission(api, assignment.id, reason.trim()))} loading={busy} loadingLabel={t("classwork.saving")} disabled={!reason.trim()}>
              {t("classwork.work.sendRequest")}
            </Button>
          </div>
        </>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}
