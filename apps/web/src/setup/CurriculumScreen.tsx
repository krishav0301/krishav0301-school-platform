"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { ReadOnlyNote } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Field, Notice, Select } from "@/ui";

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

export function GroupForm({ levelId, onAdded }: { levelId: string; onAdded: () => void }) {
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
      <h3 className={styles.formTitle}>{t("setup.curriculum.addGroup")}</h3>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field label={t("setup.curriculum.groupName")} hint={t("setup.curriculum.groupNameHint")} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} error={say(errors.name)} />
      <Field label={t("setup.curriculum.pickCount")} inputMode="numeric" maxLength={2} autoComplete="off" value={pick} onChange={(event) => setPick(event.target.value)} error={say(errors.pick)} />
      <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("setup.working")}>
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
}: {
  levelId: string;
  subjects: readonly Subject[];
  offerings: readonly Offering[];
  groups: readonly Group[];
  onAdded: () => void;
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
      <h3 className={styles.formTitle}>{t("setup.curriculum.addSubject", words)}</h3>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Select
        label={t("setup.curriculum.subject")}
        value={subjectId}
        onChange={(event) => setSubjectId(event.target.value)}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...choices]}
        error={errors.subject ? t(errors.subject) : undefined}
      />
      <Field
        label={t("setup.curriculum.credit")}
        hint={t("setup.curriculum.creditHint")}
        inputMode="decimal"
        autoComplete="off"
        value={credit}
        onChange={(event) => setCredit(event.target.value)}
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
    <details className={styles.disclosure}>
      <summary className={styles.summary}>{t("setup.curriculum.addMark")}</summary>
      <form onSubmit={submit} noValidate className={styles.inline} aria-label={`${t("setup.curriculum.addMark")}: ${subjectName}`}>
        {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
        <Field label={t("setup.curriculum.markName")} hint={t("setup.curriculum.markNameHint")} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} error={say(errors.name)} />
        <Field label={t("setup.curriculum.maxMarks")} inputMode="decimal" autoComplete="off" value={max} onChange={(event) => setMax(event.target.value)} error={say(errors.max)} />
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
    </details>
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
  /** Called after a component is added, so the screen can reload. */
  onChanged?: () => void;
}

/** One level's elective groups, subjects and mark components. Switching off keeps the history; nothing is deleted. */
export function CurriculumView({ curriculum, canManage, busy, onToggleGroup, onToggleOffering, onSetGroup, onToggleComponent, onChanged = () => {} }: CurriculumViewProps) {
  const { term } = useConfig();
  const words = termWords(term);
  const { groups, offerings } = curriculum;

  const toggle = (id: string, label: MessageKey, labelOn: MessageKey, active: boolean, name: string, run: () => void) => (
    <Button
      variant="quiet"
      loading={busy === id}
      loadingLabel={t("setup.working")}
      disabled={busy !== null && busy !== id}
      aria-label={t(active ? label : labelOn, { name })}
      onClick={run}
    >
      {t(active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
    </Button>
  );

  return (
    <>
      <h2 className={styles.subhead}>{t("setup.curriculum.groups")}</h2>
      {groups.length === 0 ? (
        <p className={styles.empty}>{t("setup.curriculum.groupsEmpty")}</p>
      ) : (
        <ul className={styles.list}>
          {groups.map((group) => (
            <li key={group.id} className={styles.item}>
              <h3 className={styles.itemTitle}>{group.name}</h3>
              <div className={styles.badges}>
                <Badge>{t("setup.curriculum.groupPicks", { n: group.pickCount })}</Badge>
                {group.active ? null : <Badge>{t("setup.curriculum.groupOff")}</Badge>}
              </div>
              {canManage ? <div className={styles.actions}>{toggle(group.id, "setup.curriculum.groupSwitchOffItem", "setup.curriculum.groupSwitchOnItem", group.active, group.name, () => onToggleGroup(group))}</div> : null}
            </li>
          ))}
        </ul>
      )}

      <h2 className={styles.subhead}>{t("setup.curriculum.subjects")}</h2>
      {offerings.length === 0 ? (
        <p className={styles.empty}>{t("setup.curriculum.subjectsEmpty", words)}</p>
      ) : (
        <ul className={styles.list}>
          {offerings.map((offering) => (
            <li key={offering.id} className={styles.item}>
              <h3 className={styles.itemTitle}>{offering.subject.name}</h3>
              <div className={styles.badges}>
                {offering.subject.code ? <Badge>{t("setup.subjects.codeIs", { code: offering.subject.code })}</Badge> : null}
                {offering.creditHundredths !== null ? <Badge>{t("setup.curriculum.creditIs", { credit: formatHundredths(offering.creditHundredths) })}</Badge> : null}
                {!canManage && offering.group ? <Badge>{offering.group.name}</Badge> : null}
                {offering.active ? null : <Badge>{t("setup.curriculum.subjectOff")}</Badge>}
              </div>

              {canManage ? (
                <Select
                  label={t("setup.curriculum.groupOf", { name: offering.subject.name })}
                  value={offering.group?.id ?? ""}
                  disabled={busy !== null}
                  onChange={(event) => onSetGroup(offering, event.target.value || null)}
                  options={groupOptions(groups, offering.group?.id ?? null)}
                />
              ) : null}

              <h4 className={styles.subhead}>{t("setup.curriculum.marks")}</h4>
              {offering.components.length === 0 ? (
                <p className={styles.empty}>{t("setup.curriculum.marksEmpty")}</p>
              ) : (
                <ul className={styles.levels}>
                  {offering.components.map((component) => (
                    <li key={component.id} className={styles.level}>
                      <span className={styles.levelName}>{t(component.kind === "practical" ? "setup.curriculum.markLinePractical" : "setup.curriculum.markLine", { name: component.name, max: formatHundredths(component.maxHundredths) })}</span>
                      {component.active ? null : <Badge>{t("setup.curriculum.markOff")}</Badge>}
                      {canManage ? toggle(component.id, "setup.curriculum.markSwitchOffItem", "setup.curriculum.markSwitchOnItem", component.active, component.name, () => onToggleComponent(component)) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? <ComponentForm offeringId={offering.id} name={offering.subject.name} onAdded={onChanged} /> : null}

              {canManage ? <div className={styles.actions}>{toggle(offering.id, "setup.curriculum.subjectSwitchOffItem", "setup.curriculum.subjectSwitchOnItem", offering.active, offering.subject.name, () => onToggleOffering(offering))}</div> : null}
            </li>
          ))}
        </ul>
      )}
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
  // The Principal reads; an empty "Choose…" is a dead end, so the first level opens (D-104).
  const firstLevel = !canManage && programmes.view.status === "ready" ? (levelChoices(programmes.view.data.programmes)[0]?.value ?? "") : "";
  const levelId = picked || firstLevel;
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

  return (
    <>
      {canManage ? (
        <>
          <h1 className={styles.title}>{t("setup.curriculum.title")}</h1>
          <p className={styles.muted}>{t("setup.curriculum.intro", words)}</p>
        </>
      ) : (
        <ReadSetupHeader title={t("setup.curriculum.title")} subtitle={t("setup.read.curriculumSubtitle", midSentence(words))} />
      )}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}

      <Gate view={programmes.view} onRetry={() => void programmes.reload()}>
        {({ programmes: list }) => {
          const choices = levelChoices(list);
          if (choices.length === 0) return <p className={styles.empty}>{t("setup.curriculum.noLevels", words)}</p>;
          return (
            <div className={styles.filters}>
              <Select
                label={t("setup.curriculum.pick", words)}
                value={levelId}
                onChange={(event) => {
                  setFlash(null);
                  setLevelId(event.target.value);
                }}
                options={canManage ? [{ value: "", label: t("setup.programmes.choose") }, ...choices] : choices}
              />
            </div>
          );
        }}
      </Gate>

      {levelId ? (
        <Gate view={curriculum.view} onRetry={() => void curriculum.reload()}>
          {(data) =>
            data === null ? null : (
              canManage ? (
              <>
                <CurriculumView
                  curriculum={data}
                  canManage={canManage}
                  busy={busy}
                  onChanged={added}
                  onToggleGroup={(g) => void run(g.id, () => setGroupActive(api, g.id, !g.active), onOff(g.active))}
                  onToggleOffering={(o) => void run(o.id, () => setOfferingActive(api, o.id, !o.active), onOff(o.active))}
                  onSetGroup={(o, groupId) => void run(o.id, () => setOfferingGroup(api, o.id, groupId), "setup.done.changed")}
                  onToggleComponent={(c) => void run(c.id, () => setComponentActive(api, c.id, !c.active), onOff(c.active))}
                />
                {canManage ? (
                  <>
                    <GroupForm levelId={levelId} onAdded={added} />
                    {subjects.view.status === "ready" ? <OfferingForm levelId={levelId} subjects={subjects.view.data.subjects} offerings={data.offerings} groups={data.groups} onAdded={added} /> : null}
                  </>
                ) : null}
              </>
              ) : (
                <CurriculumTable curriculum={data} />
              )
            )
          }
        </Gate>
      ) : null}

      {canManage ? null : <ReadOnlyNote>{t("setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </>
  );
}
