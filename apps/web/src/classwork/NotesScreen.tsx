"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, Select, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { gateFailure, loadMyToday, loadStudentNotes, loadTeacherNotes, shareNote, withdrawNote, type Sent } from "./client";
import { className, subjectChoice, subjectKey, type StudentNotes, type Subject, type TeacherNotes } from "./model";

const KIND_LABEL = { note: "classwork.notes.kind.note", question_paper: "classwork.notes.kind.questionPaper" } as const;

/** Notes and question papers (D-072): a teacher shares and withdraws; a student reads their class's, watermarked. */
export function NotesScreen() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  return (
    <>
      <h1 className={setupStyles.title}>{t("classwork.notes.title")}</h1>
      {roles.includes("teacher") ? <TeacherNotesView /> : null}
      {roles.includes("student") ? <StudentNotesView /> : null}
    </>
  );
}

function sentMessage(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid") return sent.message;
  if (sent.reason === "closed") return t("classwork.closed");
  if (sent.reason === "refused") return t("classwork.refused");
  return t("classwork.failed");
}

function TeacherNotesView() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const [subjects, notes] = await Promise.all([loadMyToday(api), loadTeacherNotes(api)]);
    if (!subjects.ok) return gateFailure(subjects.reason);
    if (!notes.ok) return gateFailure(notes.reason);
    return { ok: true as const, data: { subjects: subjects.data.subjects, notes: notes.data } };
  }, [api]);
  const { view, reload } = useLoad<{ subjects: Subject[]; notes: TeacherNotes }>(loadNow);

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {({ subjects, notes }) => (
        <>
          {subjects.length === 0 ? <p className={setupStyles.empty}>{t("classwork.activity.noSubjects")}</p> : <ShareForm subjects={subjects} onShared={() => void reload()} />}
          <section aria-labelledby="shared-notes" className={setupStyles.page}>
            <h2 id="shared-notes" className={setupStyles.subhead}>
              {t("classwork.notes.shared")}
            </h2>
            {notes.notes.length === 0 ? (
              <p className={setupStyles.empty}>{t("classwork.notes.noneShared")}</p>
            ) : (
              <ul className={styles.list}>
                {notes.notes.map((note) => (
                  <SharedNote key={note.id} note={note} onChanged={() => void reload()} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Gate>
  );
}

function ShareForm({ subjects, onShared }: { subjects: Subject[]; onShared: () => void }) {
  const { api } = useSession();
  const [target, setTarget] = useState(subjectKey(subjects[0]!));
  const [kind, setKind] = useState<"note" | "question_paper">("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function share() {
    const subject = subjects.find((s) => subjectKey(s) === target)!;
    setBusy(true);
    const sent = await shareNote(api, {
      classId: subject.classId,
      offeringId: subject.offeringId,
      kind,
      title: title.trim(),
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(link.trim() ? { link: link.trim() } : {}),
    });
    setBusy(false);
    if (sent.ok) {
      setTitle("");
      setBody("");
      setLink("");
      setMessage({ tone: "ok", text: t("classwork.notes.sharedDone") });
      onShared();
    } else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }

  return (
    <section aria-labelledby="share-note" className={styles.card}>
      <h2 id="share-note" className={setupStyles.subhead}>
        {t("classwork.notes.shareTitle")}
      </h2>
      <p className={setupStyles.muted}>{t("classwork.notes.shareIntro")}</p>
      <Select label={t("classwork.subject")} options={subjects.map(subjectChoice)} value={target} onChange={(event) => setTarget(event.target.value)} />
      <Select
        label={t("classwork.notes.kind")}
        options={[
          { value: "note", label: t(KIND_LABEL.note) },
          { value: "question_paper", label: t(KIND_LABEL.question_paper) },
        ]}
        value={kind}
        onChange={(event) => setKind(event.target.value as "note" | "question_paper")}
      />
      <Field label={t("classwork.notes.titleLabel")} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      <TextArea label={t("classwork.notes.body")} hint={t("classwork.notes.bodyHint")} rows={6} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} />
      <Field label={t("classwork.link")} hint={t("classwork.linkHint")} type="url" inputMode="url" value={link} maxLength={500} onChange={(event) => setLink(event.target.value)} />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} onClick={() => void share()} loading={busy} loadingLabel={t("classwork.saving")} disabled={!title.trim() || (!body.trim() && !link.trim())}>
          {t("classwork.notes.share")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

function SharedNote({ note, onChanged }: { note: TeacherNotes["notes"][number]; onChanged: () => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function withdraw() {
    setBusy(true);
    const sent = await withdrawNote(api, note.id);
    setBusy(false);
    if (sent.ok) onChanged();
    else setError(sentMessage(sent));
  }
  return (
    <li className={styles.card}>
      <div>
        <h3>{note.title}</h3>
        <p className={styles.meta}>
          {note.subjectName} · {className(note)}
        </p>
      </div>
      <div className={setupStyles.badges}>
        <Badge>{t(KIND_LABEL[note.kind])}</Badge>
        {note.withdrawn ? <Badge>{t("classwork.withdrawn")}</Badge> : null}
      </div>
      {note.withdrawn ? null : (
        <div className={styles.actions}>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => void withdraw()} loading={busy} loadingLabel={t("classwork.saving")}>
            {t("classwork.withdraw")}
          </Button>
        </div>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </li>
  );
}

function StudentNotesView() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadStudentNotes(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<StudentNotes>(loadNow);
  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(data) => <ProtectedNotes data={data} />}
    </Gate>
  );
}

/**
 * The student's notes behind a soft protection (source 6.1): their own name and SID drawn across every note, and
 * the browser's copy menu and printing discouraged. A deterrent, never a guarantee: the words say so.
 */
export function ProtectedNotes({ data }: { data: StudentNotes }) {
  if (data.notes.length === 0) return <p className={setupStyles.empty}>{t("classwork.notes.noneYet")}</p>;
  return (
    <>
      <p className={setupStyles.muted}>{t("classwork.notes.protection")}</p>
      <ul className={`${styles.list} ${styles.protected}`} onContextMenu={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
        {data.notes.map((note) => (
          <li key={note.id} className={`${styles.card} ${styles.watermarked}`}>
            <span className={styles.watermark} aria-hidden>
              {Array.from({ length: 6 }, () => data.watermark).join("   ")}
            </span>
            <div>
              <h2 className={setupStyles.subhead}>{note.title}</h2>
              <p className={styles.meta}>
                {note.subjectName} · {note.teacherName}
              </p>
            </div>
            <div className={setupStyles.badges}>
              <Badge>{t(KIND_LABEL[note.kind])}</Badge>
            </div>
            {note.body ? <p className={styles.body}>{note.body}</p> : null}
            {note.link ? (
              <p>
                <a href={note.link} target="_blank" rel="noopener noreferrer">
                  {t("classwork.notes.openLink")}
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
