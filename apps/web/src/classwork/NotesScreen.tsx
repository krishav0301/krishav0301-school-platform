"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { gateFailure, loadMyToday, loadStudentNotes, loadTeacherNotes, shareNote, withdrawNote, type Sent } from "./client";
import { className, subjectChoice, subjectKey, type StudentNotes, type Subject, type TeacherNotes } from "./model";

const KIND_LABEL = { note: "classwork.notes.kind.note", question_paper: "classwork.notes.kind.questionPaper" } as const;

/** Notes and question papers (D-072; redesigned in D-107): a teacher shares and withdraws; a student reads their class's, watermarked. */
export function NotesScreen() {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  if (roles.includes("teacher")) return <TeacherNotesView />;
  if (roles.includes("student")) return <StudentNotesView />;
  return null;
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
  const [done, setDone] = useState<string | null>(null);
  const data = view.status === "ready" ? view.data : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("classwork.notes.title")}
        subtitle={t("classwork.notes.teacherSubtitle")}
        actions={
          data && data.subjects.length > 0 ? (
            <AddDialog label={t("classwork.notes.share")} title={t("classwork.notes.shareTitle")}>
              {(close) => (
                <ShareForm
                  subjects={data.subjects}
                  onShared={(title) => {
                    close();
                    setDone(t("classwork.notes.sharedNamed", { title }));
                    void reload();
                  }}
                />
              )}
            </AddDialog>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {data ? (
        <>
          {data.subjects.length === 0 ? <ReadOnlyNote>{t("classwork.activity.noSubjects")}</ReadOnlyNote> : null}
          <Panel title={t("classwork.notes.shared")} labelledBy="shared-notes">
            {data.notes.notes.length === 0 ? (
              <EmptyLine>{t("classwork.notes.noneShared")}</EmptyLine>
            ) : (
              <ul className={readStyles.rows}>
                {data.notes.notes.map((note) => (
                  <SharedNote key={note.id} note={note} onChanged={() => void reload()} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function ShareForm({ subjects, onShared }: { subjects: Subject[]; onShared: (title: string) => void }) {
  const { api } = useSession();
  const [target, setTarget] = useState(subjectKey(subjects[0]!));
  const [kind, setKind] = useState<"note" | "question_paper">("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    if (sent.ok) onShared(title.trim());
    else setMessage(sentMessage(sent));
  }

  return (
    <div className={styles.form}>
      <p className={styles.meta}>{t("classwork.notes.shareIntro")}</p>
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
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void share()} loading={busy} loadingLabel={t("classwork.saving")} disabled={!title.trim() || (!body.trim() && !link.trim())}>
        {t("classwork.notes.share")}
      </Button>
    </div>
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
    <li className={readStyles.rowItem}>
      <div className={readStyles.rowHead}>
        <h3 className={readStyles.rowTitle}>{note.title}</h3>
        <StatusWord tone={note.withdrawn ? undefined : "ok"}>{t(note.withdrawn ? "classwork.withdrawn" : "classwork.notes.sharedWord")}</StatusWord>
      </div>
      <p className={readStyles.rowMeta}>{[t(KIND_LABEL[note.kind]), note.subjectName, className(note)].join(" · ")}</p>
      {note.withdrawn ? null : (
        <div className={styles.rowActions}>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => void withdraw()} loading={busy} loadingLabel={t("classwork.saving")} aria-label={t("classwork.notes.withdrawNamed", { title: note.title })}>
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
    <div className={readStyles.page}>
      <ReadHeader title={t("classwork.notes.title")} subtitle={t("classwork.notes.studentSubtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <ProtectedNotes data={view.data} /> : null}
    </div>
  );
}

/**
 * The student's notes behind a soft protection (source 6.1): their own name and SID drawn across every note, and
 * the browser's copy menu and printing discouraged. A deterrent, never a guarantee: the words say so.
 */
export function ProtectedNotes({ data }: { data: StudentNotes }) {
  if (data.notes.length === 0) {
    return (
      <Panel>
        <EmptyLine>{t("classwork.notes.noneYet")}</EmptyLine>
      </Panel>
    );
  }
  return (
    <>
      <ReadOnlyNote>{t("classwork.notes.protection")}</ReadOnlyNote>
      <ul className={`${styles.list} ${styles.protected}`} onContextMenu={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
        {data.notes.map((note) => (
          <li key={note.id} className={`${styles.card} ${styles.watermarked}`}>
            <span className={styles.watermark} aria-hidden>
              {Array.from({ length: 6 }, () => data.watermark).join("   ")}
            </span>
            <div>
              <h2 className={styles.noteTitle}>{note.title}</h2>
              <p className={styles.meta}>{[t(KIND_LABEL[note.kind]), note.subjectName, note.teacherName].join(" · ")}</p>
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
