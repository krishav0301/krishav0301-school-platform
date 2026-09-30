"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { decideResubmission, gateFailure, loadAssignment, reviewWork, withdrawAssignment, type Sent } from "./client";
import { Deadline, sentMessage } from "./HomeworkScreen";
import { SUBMISSION_STATUS, className, type AssignmentDetail } from "./model";

/** One assignment for its teacher (`?id=`): every student, what they sent, the review, and resubmission requests. */
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

  return (
    <>
      <p>
        <Link href="/portal/classwork/homework">{t("classwork.work.back")}</Link>
      </p>
      <Gate view={view} onRetry={() => void reload()}>
        {(a) => <Detail assignment={a} onChanged={() => void reload()} />}
      </Gate>
    </>
  );
}

function Detail({ assignment, onChanged }: { assignment: AssignmentDetail; onChanged: () => void }) {
  const { api } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = assignment.students.filter((s) => s.submission !== null).length;

  async function withdraw() {
    setBusy(true);
    const sent = await withdrawAssignment(api, assignment.id);
    setBusy(false);
    if (sent.ok) onChanged();
    else setError(sentMessage(sent));
  }

  return (
    <>
      <div>
        <h1 className={setupStyles.title}>{assignment.title}</h1>
        <p className={styles.meta}>
          {assignment.subjectName} · {className(assignment)} · <Deadline dueAt={assignment.dueAt} dueDateBs={assignment.dueDateBs} />
        </p>
      </div>
      <p className={styles.body}>{assignment.instructions}</p>
      <div className={setupStyles.badges}>
        {assignment.withdrawn ? <Badge>{t("classwork.withdrawn")}</Badge> : <Badge>{t("classwork.work.counts", { submitted, students: assignment.students.length })}</Badge>}
      </div>
      <ul className={styles.list}>
        {assignment.students.map((student) => (
          <StudentRow key={student.enrollmentId} assignment={assignment} student={student} onChanged={onChanged} />
        ))}
      </ul>
      {assignment.withdrawn ? null : (
        <div className={styles.actions}>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => void withdraw()} loading={busy} loadingLabel={t("classwork.saving")}>
            {t("classwork.work.withdraw")}
          </Button>
        </div>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </>
  );
}

function StudentRow({ assignment, student, onChanged }: { assignment: AssignmentDetail; student: AssignmentDetail["students"][number]; onChanged: () => void }) {
  const { api } = useSession();
  const submission = student.submission;
  const [marks, setMarks] = useState(submission?.marks?.toString() ?? "");
  const [feedback, setFeedback] = useState(submission?.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Sent>) {
    setBusy(true);
    const sent = await action();
    setBusy(false);
    if (sent.ok) {
      setError(null);
      onChanged();
    } else setError(sentMessage(sent));
  }

  const parsedMarks = Number.parseInt(marks, 10);
  const reviewBody = { ...(assignment.maxMarks !== null && Number.isFinite(parsedMarks) ? { marks: parsedMarks } : {}), ...(feedback.trim() ? { feedback: feedback.trim() } : {}) };

  return (
    <li className={styles.card}>
      <div>
        <h2 className={setupStyles.subhead}>{student.name}</h2>
        <p className={styles.meta}>{student.sid}</p>
      </div>
      {submission === null ? (
        <Badge>{t("classwork.work.notSubmitted")}</Badge>
      ) : (
        <>
          <div className={setupStyles.badges}>
            <Badge tone={submission.status === "reviewed" ? "ok" : "neutral"}>{t(SUBMISSION_STATUS[submission.status])}</Badge>
            {submission.isLate ? <Badge tone="bad">{t("classwork.work.late")}</Badge> : null}
          </div>
          <p className={styles.body}>{submission.body}</p>
          {submission.status === "resubmit_requested" ? (
            <>
              <p>{t("classwork.work.requestReason", { reason: submission.resubmitReason ?? "" })}</p>
              <div className={styles.actions}>
                <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => decideResubmission(api, assignment.id, submission.id, true))} loading={busy} loadingLabel={t("classwork.saving")}>
                  {t("classwork.work.allow")}
                </Button>
                <Button className={styles.wrapLabel} variant="quiet" onClick={() => void run(() => decideResubmission(api, assignment.id, submission.id, false))} disabled={busy}>
                  {t("classwork.work.decline")}
                </Button>
              </div>
            </>
          ) : null}
          {submission.status === "submitted" || submission.status === "reviewed" ? (
            <>
              {assignment.maxMarks !== null ? (
                <Field label={t("classwork.work.marksLabel", { max: assignment.maxMarks })} inputMode="numeric" maxLength={4} value={marks} onChange={(event) => setMarks(event.target.value)} />
              ) : null}
              <TextArea label={t("classwork.work.feedback")} rows={3} maxLength={2000} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
              <div className={styles.actions}>
                <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => reviewWork(api, assignment.id, submission.id, reviewBody))} loading={busy} loadingLabel={t("classwork.saving")} disabled={Object.keys(reviewBody).length === 0}>
                  {t("classwork.work.saveReview")}
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </li>
  );
}
