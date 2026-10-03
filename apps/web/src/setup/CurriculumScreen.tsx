"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, Panel, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, readStyles } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import {
  addComponent,
  addOffering,
  createGroup,
  loadCurriculum,
  loadProgrammes,
  loadSubjects,
  setComponentActive,
  setGroupActive,
  setOfferingActive,
  setOfferingGroup,
  type Loaded,
} from "./client";
import {
  REASON_MESSAGE,
  canManageStructure,
  formatHundredths,
  levelChoices,
  parseHundredths,
  subjectChoices,
  termWords,
  type Curriculum,
  type FailReason,
  type Group,
  type MarkComponent,
  type Offering,
  type Subject,
} from "./model";
import { CurriculumTable, ReadSetupHeader, midSentence } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };
const groupOptions = (groups: readonly Group[], keep: string | null) => [
  { value: "", label: t("setup.curriculum.noGroup") },
  ...groups.filter((g) => g.active || g.id === keep).map((g) => ({ value: g.id, label: g.name })),
];

// --- The forms ---------------------------------------------------------------------------------------

export function GroupForm({ levelId, onAdded, showTitle = true }: { levelId: string; onAdded: () => void; showTitle?: boolean }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [pick, setPick] = useState("1");
  const [errors, setErrors] = useState<{ name?: MessageKey; pick?: MessageKey }>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    const pickCount = /^\d{1,2}$/.test(pick.trim()) ? Number(pick.trim()) : NaN;
    const found: typeof errors = {};
    if (!name.trim()) found.name = "setup.error.nameRequired";
    if (!(pickCount >= 1 && pickCount <= 10)) found.pick = "setup.error.pickInvalid";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = await createGroup(api, levelId, { name: name.trim(), pickCount });
    setSaving(false);
    if (result.ok) {
      setName("");
      setPick("1");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h3 className={styles.formTitle}>{t("setup.curriculum.addGroup")}</h3> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field
        label={t("setup.curriculum.groupName")}
        hint={t("setup.curriculum.groupNameHint")}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setErrors((e) => ({ ...e, name: undefined }));
        }}
        error={say(errors.name)}
      />
      <Field
        label={t("setup.curriculum.pickCount")}
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        value={pick}
        onChange={(event) => {
          setPick(event.target.value);
          setErrors((e) => ({ ...e, pick: undefined }));
        }}
        error={say(errors.pick)}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.curriculum.addGroup")}
      </Button>
    </form>
  );
}

export function OfferingForm({
  levelId,
  subjects,
  offerings,
  groups,
  onAdded,
  showTitle = true,
}: {
  levelId: string;
  subjects: readonly Subject[];
  offerings: readonly Offering[];
  groups: readonly Group[];
  onAdded: () => void;
  /** Off inside the Add pop-up, which carries the title itself. */
  showTitle?: boolean;
}) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const choices = subjectChoices(subjects, offerings);
  const [subjectId, setSubjectId] = useState("");
  const [credit, setCredit] = useState("");
  const [groupId, setGroupId] = useState("");
  const [errors, setErrors] = useState<{ subject?: MessageKey; credit?: MessageKey }>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  if (choices.length === 0) return <p className={styles.muted}>{t("setup.curriculum.noSubjectsLeft", words)}</p>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    const hundredths = credit.trim() ? parseHundredths(credit) : null;
    const found: typeof errors = {};
    if (!subjectId) found.subject = "setup.error.subjectRequired";
    if (credit.trim() && (hundredths === null || hundredths < 1 || hundredths > 10000)) found.credit = "setup.error.creditInvalid";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = await addOffering(api, { levelId, subjectId, creditHundredths: hundredths, groupId: groupId || null });
    setSaving(false);
    if (result.ok) {
      setSubjectId("");
      setCredit("");
      setGroupId("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h3 className={styles.formTitle}>{t("setup.curriculum.addSubject", words)}</h3> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Select
        label={t("setup.curriculum.subject")}
        value={subjectId}
        onChange={(event) => {
          setSubjectId(event.target.value);
          setErrors((e) => ({ ...e, subject: undefined }));
        }}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...choices]}
        error={errors.subject ? t(errors.subject) : undefined}
      />
      <Field
        label={t("setup.curriculum.credit")}
        hint={t("setup.curriculum.creditHint")}
        inputMode="decimal"
        autoComplete="off"
        value={credit}
        onChange={(event) => {
          setCredit(event.target.value);
          setErrors((e) => ({ ...e, credit: undefined }));
        }}
        error={errors.credit ? t(errors.credit) : undefined}
      />
      {groups.some((g) => g.active) ? <Select label={t("setup.curriculum.group")} value={groupId} onChange={(event) => setGroupId(event.target.value)} options={groupOptions(groups, null)} /> : null}
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.curriculum.addSubject", words)}
      </Button>
    </form>
  );
}

export function ComponentForm({ offeringId, name: subjectName, onAdded }: { offeringId: string; name: string; onAdded: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [max, setMax] = useState("");
  const [kind, setKind] = useState<"theory" | "practical">("theory");
  const [errors, setErrors] = useState<{ name?: MessageKey; max?: MessageKey }>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    const hundredths = parseHundredths(max);
    const found: typeof errors = {};
    if (!name.trim()) found.name = "setup.error.nameRequired";
    if (hundredths === null || hundredths < 1 || hundredths > 100000) found.max = "setup.error.maxInvalid";
    setErrors(found);
    if (Object.keys(found).length > 0 || hundredths === null) return;

    setSaving(true);
    const result = await addComponent(api, offeringId, { name: name.trim(), maxHundredths: hundredths, kind });
    setSaving(false);
    if (result.ok) {
      setName("");
      setMax("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.inline} aria-label={`${t("setup.curriculum.addMark")}: ${subjectName}`}>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field
        label={t("setup.curriculum.markName")}
        hint={t("setup.curriculum.markNameHint")}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setErrors((e) => ({ ...e, name: undefined }));
        }}
        error={say(errors.name)}
      />
      <Field
        label={t("setup.curriculum.maxMarks")}
        inputMode="decimal"
        autoComplete="off"
        value={max}
        onChange={(event) => {
          setMax(event.target.value);
          setErrors((e) => ({ ...e, max: undefined }));
        }}
        error={say(errors.max)}
      />
      <Select
        label={t("setup.curriculum.markKind")}
        hint={t("setup.curriculum.markKindHint")}
        value={kind}
        onChange={(event) => setKind(event.target.value === "practical" ? "practical" : "theory")}
        options={[
          { value: "theory", label: t("setup.curriculum.kind.theory") },
          { value: "practical", label: t("setup.curriculum.kind.practical") },
        ]}
      />
      <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("setup.working")} aria-label={`${t("setup.curriculum.addMark")}: ${subjectName}`}>
        {t("setup.curriculum.addMark")}
      </Button>
    </form>
  );
}

// --- The view ----------------------------------------------------------------------------------------

export interface CurriculumViewProps {
  curriculum: Curriculum;
  canManage: boolean;
  busy: string | null;
  onToggleGroup: (group: Group) => void;
  onToggleOffering: (offering: Offering) => void;
  onSetGroup: (offering: Offering, groupId: string | null) => void;
  onToggleComponent: (component: MarkComponent) => void;
  /** Called after a group or component is added, so the screen can reload. */
  onChanged?: () => void;
  /** What the last change said, shown where the person is working (the open subject's panel, or the page). */
  notice?: ReactNode;
}

const markLine = (c: MarkComponent) => t(c.kind === "practical" ? "setup.curriculum.markLinePractical" : "setup.curriculum.markLine", { name: c.name, max: formatHundredths(c.maxHundredths) });

/** The marks a subject is out of, in one line: its components still in use. */
const marksSummary = (o: Offering) => {
  const live = o.components.filter((c) => c.active);
  return live.length === 0 ? t("setup.curriculum.marksEmpty") : live.map(markLine).join(" · ");
};

/** Switch off or on, named for what it switches. */
function SwitchButton({ id, busy, active, name, label, labelOn, onClick, variant = "quiet" }: { id: string; busy: string | null; active: boolean; name: string; label: MessageKey; labelOn: MessageKey; onClick: () => void; variant?: "quiet" | "secondary" }) {
  return (
    <Button variant={variant} loading={busy === id} loadingLabel={t("setup.working")} disabled={busy !== null && busy !== id} aria-label={t(active ? label : labelOn, { name })} onClick={onClick}>
      {t(active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
    </Button>
  );
}

/** One subject of the level, opened from its row: its facts, its elective group, its mark components, and Switch off. */
export function SubjectPanel({
  curriculum,
  offering,
  busy,
  notice,
  onClose,
  onToggleOffering,
  onSetGroup,
  onToggleComponent,
  onChanged,
}: Omit<CurriculumViewProps, "canManage" | "onToggleGroup" | "onChanged"> & { offering: Offering; onClose: () => void; onChanged: () => void }) {
  return (
    <SidePanel
      title={offering.subject.name}
      subtitle={`${curriculum.level.programmeName} · ${curriculum.level.name}`}
      status={offering.active ? <StatusWord tone="ok">{t("setup.read.inUse")}</StatusWord> : <StatusWord>{t("setup.curriculum.subjectOff")}</StatusWord>}
      busy={busy !== null}
      onClose={onClose}
      foot={
        <SwitchButton
          id={offering.id}
          busy={busy}
          active={offering.active}
          name={offering.subject.name}
          label="setup.curriculum.subjectSwitchOffItem"
          labelOn="setup.curriculum.subjectSwitchOnItem"
          variant={offering.active ? "quiet" : "secondary"}
          onClick={() => onToggleOffering(offering)}
        />
      }
    >
      {notice}
      <Facts
        rows={[
          { name: t("setup.read.code"), value: offering.subject.code ?? "—" },
          { name: t("setup.read.credit"), value: offering.creditHundredths === null ? "—" : formatHundredths(offering.creditHundredths) },
        ]}
      />
      <PanelSection title={t("setup.curriculum.group")}>
        <Select
          label={t("setup.curriculum.groupOf", { name: offering.subject.name })}
          value={offering.group?.id ?? ""}
          disabled={busy !== null}
          onChange={(event) => onSetGroup(offering, event.target.value || null)}
          options={groupOptions(curriculum.groups, offering.group?.id ?? null)}
        />
      </PanelSection>
      <PanelSection title={t("setup.curriculum.marks")}>
        {offering.components.length === 0 ? (
          <p className={readStyles.rowMeta}>{t("setup.curriculum.marksEmpty")}</p>
        ) : (
          <ul className={readStyles.rows}>
            {offering.components.map((component) => (
              <li key={component.id} className={readStyles.rowItem}>
                <div className={readStyles.rowHead}>
                  <span>{markLine(component)}</span>
                  <span className={readStyles.cellWords}>
                    {component.active ? null : <StatusWord>{t("setup.curriculum.markOff")}</StatusWord>}
                    <SwitchButton
                      id={component.id}
                      busy={busy}
                      active={component.active}
                      name={component.name}
                      label="setup.curriculum.markSwitchOffItem"
                      labelOn="setup.curriculum.markSwitchOnItem"
                      onClick={() => onToggleComponent(component)}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      <PanelSection title={t("setup.curriculum.addMark")}>
        <ComponentForm key={offering.id} offeringId={offering.id} name={offering.subject.name} onAdded={onChanged} />
      </PanelSection>
    </SidePanel>
  );
}

/**
 * One level's curriculum (redesigned in D-106 after the Principal's read table): the subjects in a table, each opening a
 * side panel for its elective group and mark components; the elective groups below. Switching off keeps the history;
 * nothing is deleted. Someone who may not change it reads the Principal's table.
 */
export function CurriculumView({ curriculum, canManage, busy, onToggleGroup, onToggleOffering, onSetGroup, onToggleComponent, onChanged = () => {}, notice }: CurriculumViewProps) {
  const { term } = useConfig();
  const words = termWords(term);
  const [open, setOpen] = useState<string | null>(null);
  const { groups, offerings } = curriculum;
  if (!canManage) return <CurriculumTable curriculum={curriculum} />;
  const opened = offerings.find((o) => o.id === open) ?? null;

  return (
    <>
      <Panel title={t("setup.curriculum.subjects")} labelledBy="curriculum-subjects">
        {offerings.length === 0 ? (
          <EmptyLine>{t("setup.curriculum.subjectsEmpty", words)}</EmptyLine>
        ) : (
          <ReadTable
            caption={t("setup.curriculum.subjects")}
            rows={offerings}
            rowKey={(o) => o.id}
            columns={[
              { key: "subject", label: t("setup.read.subject"), primary: true, cell: (o) => (o.subject.code ? t("setup.curriculum.subjectCode", { name: o.subject.name, code: o.subject.code }) : o.subject.name) },
              { key: "credit", label: t("setup.read.credit"), align: "end", cell: (o) => (o.creditHundredths === null ? "—" : formatHundredths(o.creditHundredths)) },
              { key: "marks", label: t("setup.curriculum.marks"), cell: marksSummary },
              { key: "group", label: t("setup.read.elective"), cell: (o) => o.group?.name ?? t("setup.read.compulsory") },
              { key: "status", label: t("attendance.class.status"), cell: (o) => (o.active ? <StatusWord tone="ok">{t("setup.read.inUse")}</StatusWord> : <StatusWord>{t("setup.curriculum.subjectOff")}</StatusWord>) },
              {
                key: "edit",
                label: t("setup.read.actions"),
                align: "end",
                plain: true,
                cell: (o) => (
                  <Button variant="secondary" aria-label={t("setup.curriculum.editItem", { name: o.subject.name })} onClick={() => setOpen(o.id)}>
                    {t("setup.curriculum.edit")}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Panel>

      <Panel
        title={t("setup.curriculum.groups")}
        labelledBy="curriculum-groups"
        actions={
          <AddDialog label={t("setup.curriculum.addGroup")} title={t("setup.curriculum.addGroup")} variant="secondary">
            {(close) => (
              <GroupForm
                levelId={curriculum.level.id}
                showTitle={false}
                onAdded={() => {
                  close();
                  onChanged();
                }}
              />
            )}
          </AddDialog>
        }
      >
        <p className={readStyles.rowMeta}>{t("setup.curriculum.groupsHint")}</p>
        {groups.length === 0 ? (
          <EmptyLine>{t("setup.curriculum.groupsEmpty")}</EmptyLine>
        ) : (
          <ul className={readStyles.rows}>
            {groups.map((group) => {
              const names = offerings.filter((o) => o.group?.id === group.id).map((o) => o.subject.name);
              return (
                <li key={group.id} className={readStyles.rowItem}>
                  <div className={readStyles.rowHead}>
                    <h3 className={readStyles.rowTitle}>{group.name}</h3>
                    <span className={readStyles.cellWords}>
                      {group.active ? null : <StatusWord>{t("setup.curriculum.groupOff")}</StatusWord>}
                      <SwitchButton
                        id={group.id}
                        busy={busy}
                        active={group.active}
                        name={group.name}
                        label="setup.curriculum.groupSwitchOffItem"
                        labelOn="setup.curriculum.groupSwitchOnItem"
                        onClick={() => onToggleGroup(group)}
                      />
                    </span>
                  </div>
                  <p className={readStyles.rowMeta}>{names.length > 0 ? t("setup.read.choose", { n: group.pickCount, names: names.join(", ") }) : t("setup.curriculum.groupPicks", { n: group.pickCount })}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {opened ? (
        <SubjectPanel
          curriculum={curriculum}
          offering={opened}
          busy={busy}
          notice={notice}
          onClose={() => setOpen(null)}
          onToggleOffering={onToggleOffering}
          onSetGroup={onSetGroup}
          onToggleComponent={onToggleComponent}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

// --- The screen --------------------------------------------------------------------------------------

export function CurriculumScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const canManage = canManageStructure(me?.roles ?? []);
  const loadProgrammesNow = useCallback(() => loadProgrammes(api), [api]);
  const loadSubjectsNow = useCallback(() => loadSubjects(api), [api]);
  const programmes = useLoad(loadProgrammesNow);
  const subjects = useLoad(loadSubjectsNow);
  const [picked, setLevelId] = useState("");
  // An empty "Choose…" is a dead end, so the first level opens for everyone (D-104, and for the Co-ordinator D-106).
  const choices = programmes.view.status === "ready" ? levelChoices(programmes.view.data.programmes) : [];
  const levelId = picked || (choices[0]?.value ?? "");
  const loadCurriculumNow = useCallback(
    (): Promise<Loaded<Curriculum | null>> => (levelId ? loadCurriculum(api, levelId) : Promise.resolve({ ok: true, data: null })),
    [api, levelId],
  );
  const curriculum = useLoad(loadCurriculumNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<{ ok: true } | { ok: false; reason: FailReason }>, done: MessageKey) {
    if (busy) return;
    setBusy(id);
    setFlash(null);
    const result = await action();
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t(done) } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await curriculum.reload();
  }
  const added = () => {
    setFlash({ tone: "ok", text: t("setup.done.added") });
    void curriculum.reload();
  };
  const onOff = (active: boolean): MessageKey => (active ? "setup.done.switchedOff" : "setup.done.switchedOn");
  const data = curriculum.view.status === "ready" ? curriculum.view.data : null;
  const notice = flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null;

  return (
    <>
      {canManage ? (
        <ReadHeader
          title={t("setup.curriculum.title")}
          subtitle={t("setup.curriculum.intro", words)}
          actions={
            data && subjects.view.status === "ready" ? (
              <AddDialog label={t("setup.curriculum.addSubject", words)} title={t("setup.curriculum.addSubject", words)}>
                {(close) => (
                  <OfferingForm
                    levelId={data.level.id}
                    subjects={subjects.view.status === "ready" ? subjects.view.data.subjects : []}
                    offerings={data.offerings}
                    groups={data.groups}
                    showTitle={false}
                    onAdded={() => {
                      close();
                      added();
                    }}
                  />
                )}
              </AddDialog>
            ) : undefined
          }
        />
      ) : (
        <ReadSetupHeader title={t("setup.curriculum.title")} subtitle={t("setup.read.curriculumSubtitle", midSentence(words))} />
      )}
      {notice}

      <Gate view={programmes.view} onRetry={() => void programmes.reload()}>
        {() =>
          choices.length === 0 ? (
            <EmptyLine>{t("setup.curriculum.noLevels", words)}</EmptyLine>
          ) : (
            <div className={readStyles.search}>
              <Select
                label={t("setup.curriculum.pick", words)}
                value={levelId}
                onChange={(event) => {
                  setFlash(null);
                  setLevelId(event.target.value);
                }}
                options={choices}
              />
            </div>
          )
        }
      </Gate>

      {levelId ? (
        <Gate view={curriculum.view} onRetry={() => void curriculum.reload()}>
          {(level) =>
            level === null ? null : (
              <CurriculumView
                curriculum={level}
                canManage={canManage}
                busy={busy}
                notice={notice}
                onChanged={added}
                onToggleGroup={(g) => void run(g.id, () => setGroupActive(api, g.id, !g.active), onOff(g.active))}
                onToggleOffering={(o) => void run(o.id, () => setOfferingActive(api, o.id, !o.active), onOff(o.active))}
                onSetGroup={(o, groupId) => void run(o.id, () => setOfferingGroup(api, o.id, groupId), "setup.done.changed")}
                onToggleComponent={(c) => void run(c.id, () => setComponentActive(api, c.id, !c.active), onOff(c.active))}
              />
            )
          }
        </Gate>
      ) : null}

      {canManage ? null : <ReadOnlyNote>{t("setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </>
  );
}
