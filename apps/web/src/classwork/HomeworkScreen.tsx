"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, Select, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { gateFailure, loadMyToday, loadStudentAssignments, loadTeacherAssignments, requestResubmission, setAssignment, submitWork, type Sent } from "./client";
import { SUBMISSION_STATUS, className, dueInstant, nepalTime, subjectChoice, subjectKey, type StudentAssignments, type Subject, type TeacherAssignments } from "./model";

/** Homework (D-072): a teacher sets work and sees what came in; a student submits, reads the review, asks to resubmit. */
export function HomeworkScreen() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  return (
    <>
      <h1 className={setupStyles.title}>{t("classwork.work.title")}</h1>
      {roles.includes("teacher") ? <TeacherWork /> : null}
      {roles.includes("student") ? <StudentWork /> : null}
    </>
  );
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
  return <>{t("classwork.work.due", { time: nepalTime(dueAt), date: dueDateBs ?? dueAt.slice(0, 10) })}</>;
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
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {({ subjects, work }) => (
        <>
          {subjects.length === 0 ? <p className={setupStyles.empty}>{t("classwork.activity.noSubjects")}</p> : <SetWorkForm subjects={subjects} onSet={() => void reload()} />}
          <section aria-labelledby="set-work" className={setupStyles.page}>
            <h2 id="set-work" className={setupStyles.subhead}>
              {t("classwork.work.set")}
            </h2>
            {work.assignments.length === 0 ? (
              <p className={setupStyles.empty}>{t("classwork.work.noneSet")}</p>
            ) : (
              <ul className={setupStyles.list}>
                {work.assignments.map((a) => (
                  <li key={a.id} className={setupStyles.item}>
                    <h3 className={setupStyles.itemTitle}>
                      <Link href={`/portal/classwork/homework/assignment?id=${a.id}`}>{a.title}</Link>
                    </h3>
                    <p className={styles.meta}>
                      {a.subjectName} · {className(a)} · <Deadline dueAt={a.dueAt} dueDateBs={a.dueDateBs} />
                    </p>
                    <div className={setupStyles.badges}>
                      {a.withdrawn ? <Badge>{t("classwork.withdrawn")}</Badge> : <Badge>{t("classwork.work.counts", { submitted: a.submitted, students: a.students })}</Badge>}
                      {a.toReview > 0 ? <Badge>{t("classwork.work.toReview", { count: a.toReview })}</Badge> : null}
                      {a.requests > 0 ? <Badge>{t("classwork.work.requests", { count: a.requests })}</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Gate>
  );
}

function SetWorkForm({ subjects, onSet }: { subjects: Subject[]; onSet: () => void }) {
  const { api } = useSession();
  const [target, setTarget] = useState(subjectKey(subjects[0]!));
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [link, setLink] = useState("");
  const [dueBs, setDueBs] = useState("");
  const [dueTime, setDueTime] = useState("10:00");
  const [maxMarks, setMaxMarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    const day = await toAd(api, dueBs.trim());
    if (!day.ok) {
      setBusy(false);
      return setMessage({ tone: "bad", text: t("classwork.work.badDay") });
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
    if (sent.ok) {
      setTitle("");
      setInstructions("");
      setLink("");
      setMaxMarks("");
      setMessage({ tone: "ok", text: t("classwork.work.setDone") });
      onSet();
    } else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }

  return (
    <section aria-labelledby="new-work" className={styles.card}>
      <h2 id="new-work" className={setupStyles.subhead}>
        {t("classwork.work.newTitle")}
      </h2>
      <Select label={t("classwork.subject")} options={subjects.map(subjectChoice)} value={target} onChange={(event) => setTarget(event.target.value)} />
      <Field label={t("classwork.work.titleLabel")} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      <TextArea label={t("classwork.work.instructions")} rows={5} maxLength={5000} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
      <BsDateField legend={t("classwork.work.dueDay")} hint={t("classwork.pickDayHint")} value={dueBs} onChange={setDueBs} />
      <Field label={t("classwork.work.dueTime")} hint={t("classwork.work.dueTimeHint")} type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
      <Field label={t("classwork.work.maxMarks")} hint={t("classwork.work.maxMarksHint")} inputMode="numeric" value={maxMarks} maxLength={4} onChange={(event) => setMaxMarks(event.target.value)} />
      <Field label={t("classwork.link")} hint={t("classwork.linkHint")} type="url" inputMode="url" value={link} maxLength={500} onChange={(event) => setLink(event.target.value)} />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} onClick={() => void submit()} loading={busy} loadingLabel={t("classwork.saving")} disabled={!title.trim() || !instructions.trim() || !dueBs.trim()}>
          {t("classwork.work.setButton")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

function StudentWork() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadStudentAssignments(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<StudentAssignments>(loadNow);
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(data) =>
        data.assignments.length === 0 ? (
          <p className={setupStyles.empty}>{t("classwork.work.noneYet")}</p>
        ) : (
          <ul className={styles.list}>
            {data.assignments.map((a) => (
              <StudentAssignment key={a.id} assignment={a} onChanged={() => void reload()} />
            ))}
          </ul>
        )
      }
    </Gate>
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
    <li className={styles.card}>
      <div>
        <h2 className={setupStyles.subhead}>{assignment.title}</h2>
        <p className={styles.meta}>
          {assignment.subjectName} · {assignment.teacherName} · <Deadline dueAt={assignment.dueAt} dueDateBs={assignment.dueDateBs} />
        </p>
      </div>
      <p className={styles.body}>{assignment.instructions}</p>
      {assignment.link ? (
        <p>
          <a href={assignment.link} target="_blank" rel="noopener noreferrer">
            {t("classwork.notes.openLink")}
          </a>
        </p>
      ) : null}
      {submission ? (
        <div className={setupStyles.badges}>
          <Badge tone={submission.status === "reviewed" ? "ok" : "neutral"}>{t(SUBMISSION_STATUS[submission.status])}</Badge>
          {submission.isLate ? <Badge tone="bad">{t("classwork.work.late")}</Badge> : null}
          {submission.marks !== null && assignment.maxMarks !== null ? <Badge>{t("classwork.work.marks", { marks: submission.marks, max: assignment.maxMarks })}</Badge> : null}
        </div>
      ) : (
        <Badge>{t("classwork.work.notSubmitted")}</Badge>
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
          <div className={styles.actions}>
            <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => submitWork(api, assignment.id, answer.trim()))} loading={busy} loadingLabel={t("classwork.saving")} disabled={!answer.trim()}>
              {t("classwork.work.submit")}
            </Button>
          </div>
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
    </li>
  );
}
