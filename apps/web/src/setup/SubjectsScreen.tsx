"use client";

import { ChevronDown, Info, Landmark } from "lucide-react";
import { useCallback, useId, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { FilterSelect, SearchBox } from "@/people/ListParts";
import { EmptyLine, ReadHeader, ReadOnlyNote, ReadTable, StatusWord } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { createSubject, loadSubjects, setSubjectArchived, updateSubject } from "./client";
import { REASON_MESSAGE, canManageInstitution, canManageStructure, manageableSections, type Subject } from "./model";
import { ReadSetupHeader } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";
import board from "./subjects-board.module.css";

type Flash = { tone: "ok" | "bad"; text: string };
type Wing = { key: string; name: string };

export type StatusFilter = "" | "inUse" | "archived";

export interface SubjectGroup {
  key: string;
  name: string;
  subjects: Subject[];
}

/**
 * The subjects by wing, in the school's order, after the search and the status filter. A wing with none is kept while
 * nothing is filtered (it still has its Add button), and left out when a filter is on. A subject with no wing (an old
 * one, D-114) goes last in a group of its own. Pure.
 */
export function groupSubjects(subjects: readonly Subject[], wings: readonly Wing[], q: string, status: StatusFilter): { groups: SubjectGroup[]; filtered: boolean } {
  const needle = q.trim().toLocaleLowerCase();
  const filtered = needle !== "" || status !== "";
  const keep = (s: Subject) => (status === "" || (status === "archived") === s.archived) && (needle === "" || s.name.toLocaleLowerCase().includes(needle) || (s.code ?? "").toLocaleLowerCase().includes(needle));
  const known = new Set(wings.map((w) => w.key));
  const groups: SubjectGroup[] = wings.map((w) => ({ key: w.key, name: w.name, subjects: subjects.filter((s) => s.sectionKey === w.key && keep(s)) }));
  const loose = subjects.filter((s) => (s.sectionKey === null || !known.has(s.sectionKey)) && keep(s));
  if (loose.length > 0) groups.push({ key: "", name: t("setup.subjects.noWing"), subjects: loose });
  return { groups: filtered ? groups.filter((g) => g.subjects.length > 0) : groups, filtered };
}

const TONES = ["primary", "ok", "accent", "warn"] as const;

const countLine = (n: number): string => t(n === 1 ? "setup.subjects.countOne" : "setup.subjects.count", { n });

/**
 * The school's subjects, one card per wing that opens to its table, as the PM drew it (D-133). A whole-school
 * Co-ordinator may change a subject (Edit, Archive or Restore); someone who may add can add to a wing from its card;
 * anyone else only reads. Archiving hides a subject from the level pickers and keeps everything that used it (D-106).
 */
export function SubjectsBoard({
  subjects,
  wings,
  q = "",
  status = "",
  canAdd = false,
  addableWings = [],
  canArchive,
  busy,
  onToggle,
  onEdit,
  onAdded,
}: {
  subjects: readonly Subject[];
  wings: readonly Wing[];
  q?: string;
  status?: StatusFilter;
  canAdd?: boolean;
  /** The wings the person may add to (a section Co-ordinator reaches only their own). */
  addableWings?: readonly string[];
  canArchive: boolean;
  busy: string | null;
  onToggle: (subject: Subject) => void;
  /** Saves a subject's name, code and wing (FUT point 17): a whole-school Co-ordinator's. True, or what went wrong. */
  onEdit?: (subject: Subject, input: { name: string; code: string; sectionKey: string }) => Promise<true | string>;
  onAdded?: () => void;
}) {
  const { term } = useConfig();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const idBase = useId();
  if (subjects.length === 0) return <EmptyLine>{t(canAdd ? "setup.subjects.empty" : "setup.subjects.emptyReadOnly")}</EmptyLine>;
  const { groups, filtered } = groupSubjects(subjects, wings, q, status);
  if (groups.length === 0) return <EmptyLine>{t("setup.subjects.noMatch")}</EmptyLine>;
  const wingWord = term("term.section").toLowerCase();

  return (
    <ul className={board.cards}>
      {groups.map((group, index) => {
        // The first wing starts open; a search or filter opens every wing that has a match.
        const open = toggled[group.key] ?? (filtered || index === 0);
        const bodyId = `${idBase}-${group.key || "none"}`;
        return (
          <li key={group.key || "none"} className={board.card}>
            <div className={board.head}>
              <span className={board.tile} data-tone={TONES[index % TONES.length]} aria-hidden>
                <Landmark strokeWidth={1.75} />
              </span>
              <div className={board.headText}>
                <h2 className={board.name}>{group.name}</h2>
                <p className={board.meta}>{countLine(group.subjects.length)}</p>
              </div>
              <div className={board.headActions}>
                {canAdd && addableWings.includes(group.key) ? (
                  <AddDialog label={t("setup.subjects.addToWing", { wing: wingWord })} title={t("setup.subjects.add")} variant="secondary">
                    {(close) => (
                      <SubjectForm
                        showTitle={false}
                        wings={[{ key: group.key, name: group.name }]}
                        onAdded={() => {
                          close();
                          onAdded?.();
                        }}
                      />
                    )}
                  </AddDialog>
                ) : null}
                <button
                  type="button"
                  className={board.disclosure}
                  aria-expanded={open}
                  aria-controls={bodyId}
                  aria-label={t("setup.subjects.toggleWing", { name: group.name })}
                  onClick={() => setToggled((all) => ({ ...all, [group.key]: !open }))}
                >
                  <ChevronDown aria-hidden className={board.chevron} data-open={open} />
                </button>
              </div>
            </div>
            {open ? (
              <div id={bodyId} className={board.body}>
                {group.subjects.length === 0 ? (
                  <EmptyLine>{t("setup.subjects.noneInWing", { wing: wingWord })}</EmptyLine>
                ) : (
                  <ReadTable
                    caption={group.name}
                    rows={group.subjects}
                    rowKey={(x) => x.id}
                    columns={[
                      { key: "name", label: t("setup.read.subject"), primary: true, cell: (x) => x.name },
                      { key: "code", label: t("setup.read.code"), cell: (x) => x.code ?? "—" },
                      { key: "status", label: t("attendance.class.status"), cell: (x) => (x.archived ? <StatusWord>{t("setup.subjects.archived")}</StatusWord> : <StatusWord tone="ok">{t("setup.read.inUse")}</StatusWord>) },
                      ...(canArchive
                        ? [
                            {
                              key: "actions",
                              label: t("setup.read.actions"),
                              plain: true,
                              align: "end" as const,
                              cell: (subject: Subject) => (
                                <span className={styles.rowActions}>
                                  {onEdit ? (
                                    <AddDialog label={t("structure.edit")} ariaLabel={t("structure.editItem", { name: subject.name })} title={t("structure.editTitle", { name: subject.name })} variant="quiet" plus={false}>
                                      {(close) => (
                                        <SubjectEditForm
                                          subject={subject}
                                          wings={wings}
                                          onSave={async (input) => {
                                            const saved = await onEdit(subject, input);
                                            if (saved === true) close();
                                            return saved;
                                          }}
                                        />
                                      )}
                                    </AddDialog>
                                  ) : null}
                                  <Button
                                    variant="quiet"
                                    loading={busy === subject.id}
                                    loadingLabel={t("setup.working")}
                                    disabled={busy !== null && busy !== subject.id}
                                    aria-label={t(subject.archived ? "setup.subjects.restoreItem" : "setup.subjects.archiveItem", { name: subject.name })}
                                    onClick={() => onToggle(subject)}
                                  >
                                    {t(subject.archived ? "setup.subjects.restore" : "setup.subjects.archive")}
                                  </Button>
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Editing a subject (FUT point 17): its name, its code (empty for none) and its wing. The wing is fixed once a curriculum
 * uses the subject, and the field says so; the server checks the same as it saves. A failure is said inside the pop-up
 * (admin FUT F-01).
 */
export function SubjectEditForm({ subject, wings, onSave }: { subject: Subject; wings: readonly { key: string; name: string }[]; onSave: (input: { name: string; code: string; sectionKey: string }) => Promise<true | string> }) {
  const [name, setName] = useState(subject.name);
  const [code, setCode] = useState(subject.code ?? "");
  const [wing, setWing] = useState(subject.sectionKey ?? "");
  const [errors, setErrors] = useState<{ name?: string; wing?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found = { name: name.trim() ? undefined : t("setup.error.nameRequired"), wing: wing ? undefined : t("setup.subjects.wingRequired") };
    setErrors(found);
    if (found.name || found.wing) return;
    setSaving(true);
    setProblem(null);
    const saved = await onSave({ name: name.trim(), code: code.trim(), sectionKey: wing });
    setSaving(false);
    if (saved !== true) setProblem(saved);
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("setup.subjects.name")} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} error={errors.name} />
      <Field label={t("setup.subjects.code")} hint={t("setup.subjects.codeHint")} value={code} maxLength={20} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
      <Select
        label={t("setup.subjects.wing")}
        hint={t(subject.inCurriculum ? "setup.subjects.wingInUse" : "setup.subjects.wingFree")}
        value={wing}
        disabled={subject.inCurriculum}
        onChange={(event) => setWing(event.target.value)}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
        error={errors.wing}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("structure.saveChanges")}
      </Button>
    </form>
  );
}

/** A new subject: its wing (only the wings the person reaches; one is chosen for them), name and code (D-114). */
export function SubjectForm({ onAdded, showTitle = true, wings }: { onAdded: () => void; showTitle?: boolean; wings: readonly { key: string; name: string }[] }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [picked, setWing] = useState("");
  const [wingError, setWingError] = useState(false);
  const wing = wings.length === 1 ? wings[0]!.key : picked;
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setWingError(!wing);
    if (!name.trim()) setError("setup.error.nameRequired");
    if (!name.trim() || !wing) return;
    setError(null);
    setSaving(true);
    const result = await createSubject(api, { name: name.trim(), code: code.trim(), sectionKey: wing });
    setSaving(false);
    if (result.ok) {
      setName("");
      setCode("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h2 className={styles.formTitle}>{t("setup.subjects.add")}</h2> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      {wings.length === 1 ? (
        <p className={styles.pickerGiven}>{t("setup.subjects.inWing", { wing: wings[0]!.name })}</p>
      ) : (
        <Select
          label={t("setup.subjects.wing")}
          value={picked}
          onChange={(event) => {
            setWing(event.target.value);
            setWingError(false);
          }}
          options={[{ value: "", label: t("setup.programmes.choose") }, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
          error={wingError ? t("setup.subjects.wingRequired") : undefined}
        />
      )}
      <Field
        label={t("setup.subjects.name")}
        value={name}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        error={error ? t(error) : undefined}
      />
      <Field label={t("setup.subjects.code")} hint={t("setup.subjects.codeHint")} value={code} maxLength={20} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.subjects.add")}
      </Button>
    </form>
  );
}

/** Said once, at the foot: where a subject is made and where it is given to a level. */
export function SubjectsNote() {
  return (
    <div className={board.note}>
      <Info aria-hidden strokeWidth={1.75} />
      <div>
        <p className={board.noteTitle}>{t("setup.subjects.noteTitle")}</p>
        <p className={board.noteBody}>{t("setup.subjects.noteBody")}</p>
      </div>
    </div>
  );
}

export function SubjectsScreen() {
  const { api, me } = useSession();
  const { term, config } = useConfig();
  const wings = config?.sections ?? [];
  const roles = me?.roles ?? [];
  const canAdd = canManageStructure(roles);
  const canArchive = canManageInstitution(roles);
  const addable = manageableSections(roles, wings);
  const load = useCallback(() => loadSubjects(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const coordinator = term("role.coordinator");

  async function toggle(subject: Subject) {
    if (busy) return;
    setBusy(subject.id);
    setFlash(null);
    const result = await setSubjectArchived(api, subject.id, !subject.archived);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t(subject.archived ? "setup.done.restored" : "setup.done.archived") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await reload();
  }

  async function saveEdit(subject: Subject, input: { name: string; code: string; sectionKey: string }): Promise<true | string> {
    const result = await updateSubject(api, subject.id, input);
    if (!result.ok) return t(REASON_MESSAGE[result.reason]);
    setFlash({ tone: "ok", text: t("structure.done.saved") });
    await reload();
    return true;
  }

  const added = () => {
    setFlash({ tone: "ok", text: t("setup.done.added") });
    void reload();
  };

  return (
    <>
      {canAdd ? <ReadHeader title={t("setup.subjects.title")} subtitle={t("setup.subjects.intro")} /> : <ReadSetupHeader title={t("setup.subjects.title")} subtitle={t("setup.read.subjectsSubtitle")} />}
      <div className={board.toolbar}>
        <SearchBox label="setup.subjects.search" value={q} onChange={setQ} />
        <FilterSelect
          label="setup.subjects.filterStatus"
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={[
            { value: "", label: t("setup.subjects.filterAll") },
            { value: "inUse", label: t("setup.read.inUse") },
            { value: "archived", label: t("setup.subjects.archived") },
          ]}
        />
        {canAdd ? (
          <div className={board.toolbarAdd}>
            <AddDialog label={t("setup.subjects.add")} title={t("setup.subjects.add")}>
              {(close) => (
                <SubjectForm
                  showTitle={false}
                  wings={addable}
                  onAdded={() => {
                    close();
                    added();
                  }}
                />
              )}
            </AddDialog>
          </div>
        ) : null}
      </div>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ subjects }) => (
          <SubjectsBoard
            subjects={subjects}
            wings={wings}
            q={q}
            status={status}
            canAdd={canAdd}
            addableWings={addable.map((w) => w.key)}
            canArchive={canArchive}
            busy={busy}
            onToggle={(s) => void toggle(s)}
            {...(canArchive ? { onEdit: saveEdit } : {})}
            onAdded={added}
          />
        )}
      </Gate>
      <SubjectsNote />
      {canAdd && !canArchive ? <ReadOnlyNote>{t("setup.subjects.onlyWholeSchool", { coordinator })}</ReadOnlyNote> : null}
      {canAdd ? null : <ReadOnlyNote>{t("setup.read.readOnly", { coordinator })}</ReadOnlyNote>}
    </>
  );
}
