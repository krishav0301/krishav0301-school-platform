"use client";

import { BookOpen, ChevronDown, Database, GraduationCap, Layers, MoreVertical, Users, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useId, useState, type FormEvent, type ReactNode } from "react";

import type { components } from "@/api/schema";
import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Badge, Button, Field, Notice, Select, Skeleton, TitleRow } from "@/ui";

import {
  addLevel,
  createProgramme,
  createSection,
  deleteLevel,
  deleteProgramme,
  deleteSection,
  loadProgrammes,
  renameLevel,
  updateSection,
  setLevelActive,
  setProgrammeActive,
  setSectionActive,
  updateProgramme,
  type WriteResult,
} from "./client";
import { REASON_MESSAGE, canManageProgrammes, isReceiptCode, suggestReceiptCode, termWords, type Level, type Programme } from "./model";
import { useLoad } from "./useLoad";
import styles from "./structure.module.css";

/**
 * Academic Structure (D-096): the school as sections, then programmes, then levels, built by the Admin (D-087, D-095).
 * Everything shown is read from the one programme list (`GET /api/academics/programmes`): the four figures, each
 * section's, programme's and level's counts, and the students of the active year. Nothing is deleted: a programme or a
 * level is switched off and keeps its history.
 */

export type Structure = components["schemas"]["ProgrammeList"];
type Section = Structure["sections"][number];
type Words = ReturnType<typeof termWords>;
type Tone = "primary" | "ok" | "accent" | "warn";

/** Each card's icon tile takes the next tone, so neighbours read apart. Colour only tells them apart; the name says what each is. */
const TONES: readonly Tone[] = ["primary", "ok", "accent", "warn"];
const toneAt = (index: number): Tone => TONES[index % TONES.length]!;

const POLICY_LABEL: Record<NonNullable<Programme["gradingPolicy"]> | "none", MessageKey> = {
  none: "setup.grading.none",
  neb_gpa: "setup.grading.neb",
  percentage_division: "setup.grading.percentage",
};

const count = (n: number) => n.toLocaleString("en-IN");

/** The school's words in the middle of a sentence: "sections, programmes and levels". */
const inSentence = (words: Words): Words => ({ programme: words.programme.toLowerCase(), level: words.level.toLowerCase(), section: words.section.toLowerCase(), terminal: words.terminal.toLowerCase() });

/** "1 Student", "780 Students"; "1 Level", "4 Levels": in the school's own words. */
const studentsText = (n: number, student: string) => t(n === 1 ? "structure.studentsOne" : "structure.students", { count: count(n), student });
const levelsText = (n: number, level: string) => t(n === 1 ? "structure.levelsOne" : "structure.levelsCount", { count: count(n), level });
const programmesText = (n: number, programme: string) => t(n === 1 ? "structure.programmesOne" : "structure.programmesCount", { count: count(n), programme });

/** What every change on the page goes through: it returns whether it worked, and the screen says so. */
export interface StructureActions {
  addSection: (values: SectionValues) => Promise<boolean>;
  editSection: (section: Section, values: SectionValues) => Promise<boolean>;
  addProgramme: (sectionKey: string, values: { name: string; affiliation: string }) => Promise<boolean>;
  editProgramme: (programme: Programme, values: { name: string; affiliation: string; gradingPolicy: Programme["gradingPolicy"] }) => Promise<boolean>;
  setProgrammeActive: (programme: Programme, active: boolean) => Promise<boolean>;
  addLevel: (programme: Programme, name: string) => Promise<boolean>;
  renameLevel: (level: Level, name: string) => Promise<boolean>;
  setLevelActive: (level: Level, active: boolean) => Promise<boolean>;
  setSectionActive: (section: Section, active: boolean) => Promise<boolean>;
  /** Only offered when nothing is attached (D-097); the server checks again. */
  deleteSection: (section: Section) => Promise<boolean>;
  deleteProgramme: (programme: Programme) => Promise<boolean>;
  deleteLevel: (level: Level) => Promise<boolean>;
}

// --- Small pieces --------------------------------------------------------------------------------------

function Tile({ icon: Icon, tone, size = "large" }: { icon: LucideIcon; tone: Tone; size?: "large" | "small" }) {
  return (
    <span className={styles.tile} data-tone={tone} data-size={size} aria-hidden>
      <Icon strokeWidth={1.75} />
    </span>
  );
}

/** The show/hide control of a section or programme: a real button that says what it opens and whether it is open. */
function Disclosure({ open, controls, name, onToggle }: { open: boolean; controls: string; name: string; onToggle: () => void }) {
  return (
    <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={controls} aria-label={t(open ? "structure.hide" : "structure.show", { name })} onClick={onToggle}>
      <ChevronDown aria-hidden className={styles.chevron} data-open={open} />
    </button>
  );
}

/** One name and a Save: adding or renaming a section or level. */
function NameForm({ label, hint, initial = "", submitLabel, required, onSave, children }: { label: string; hint?: string; initial?: string; submitLabel: string; required: string; onSave: (name: string) => Promise<boolean>; children?: ReactNode }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError(required);
    setError(null);
    setSaving(true);
    const saved = await onSave(name.trim());
    setSaving(false);
    if (saved && !initial) setName("");
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field label={label} hint={hint} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} error={error ?? undefined} />
      <div className={styles.formActions}>
        {children}
        <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * A failed change, said inside the pop-up it was made from (admin FUT F-01): the page's own notice sits behind the
 * pop-up's backdrop, where it cannot be read. A pop-up shows only failures from after it opened.
 */
const FailureContext = createContext<{ text: string; at: number } | null>(null);

function DialogFailure() {
  const failure = useContext(FailureContext);
  const [since] = useState(() => Date.now());
  if (!failure || failure.at < since) return null;
  return (
    <div role="alert">
      <Notice tone="bad">{failure.text}</Notice>
    </div>
  );
}

export interface SectionValues {
  name: string;
  /** Left out when it is fixed, or when a section from before codes is still given none. */
  receiptCode?: string;
}

/**
 * A section's name and receipt code (D-102): for adding one, and for editing it. While adding, the code follows the
 * name as a suggestion until the Principal types their own. Once the section has issued a receipt the code is fixed
 * and only shown.
 */
function SectionForm({ words, initial, submitLabel, onSave, children }: { words: Words; initial?: Section; submitLabel: string; onSave: (values: SectionValues) => Promise<boolean>; children?: ReactNode }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.receiptCode ?? "");
  const [codeTyped, setCodeTyped] = useState(initial !== undefined);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [saving, setSaving] = useState(false);
  const locked = initial?.receiptCodeLocked ?? false;
  const legacy = initial !== undefined && initial.receiptCode === null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found: typeof errors = {};
    if (!name.trim()) found.name = t(initial ? "structure.nameRequired" : "setup.error.sectionNameRequired", words);
    if (!locked && !(legacy && code.trim() === "") && !isReceiptCode(code)) found.code = t("setup.error.receiptCodeInvalid");
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const receiptCode = locked || code.trim() === "" ? undefined : code.trim().toUpperCase();
    const saved = await onSave({ name: name.trim(), ...(receiptCode ? { receiptCode } : {}) });
    setSaving(false);
    if (saved && !initial) {
      setName("");
      setCode("");
      setCodeTyped(false);
    }
  }

  const example = `${(code.trim() || "P2").toUpperCase()}-2083-00001`;
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field
        label={t("setup.sections.name", words)}
        hint={initial ? undefined : t("setup.sections.nameHint")}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          if (!codeTyped) setCode(suggestReceiptCode(event.target.value));
        }}
        error={errors.name}
      />
      {locked ? (
        <p className={styles.meta}>{t("setup.sections.receiptCodeLocked", { code: initial?.receiptCode ?? "" })}</p>
      ) : (
        <Field
          label={t("setup.sections.receiptCode")}
          hint={legacy ? t("setup.sections.receiptCodeLegacyHint") : t("setup.sections.receiptCodeHint", { example })}
          value={code}
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setCodeTyped(true);
          }}
          error={errors.code}
        />
      )}
      <div className={styles.formActions}>
        {children}
        <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A programme's name, affiliation and grading: for adding one to a section, and for editing it. */
function ProgrammeFields({ words, initial, withGrading, submitLabel, onSave, children }: { words: Words; initial?: Programme; withGrading: boolean; submitLabel: string; onSave: (values: { name: string; affiliation: string; gradingPolicy: Programme["gradingPolicy"] }) => Promise<boolean>; children?: ReactNode }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [affiliation, setAffiliation] = useState(initial?.affiliation ?? "");
  const [policy, setPolicy] = useState<Programme["gradingPolicy"]>(initial?.gradingPolicy ?? null);
  const [errors, setErrors] = useState<{ name?: MessageKey; affiliation?: MessageKey }>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found: typeof errors = {};
    if (!name.trim()) found.name = "setup.error.nameRequired";
    if (!affiliation.trim()) found.affiliation = "setup.error.affiliationRequired";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const saved = await onSave({ name: name.trim(), affiliation: affiliation.trim(), gradingPolicy: policy });
    setSaving(false);
    if (saved && !initial) {
      setName("");
      setAffiliation("");
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field label={t("setup.programmes.name")} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} error={errors.name ? t(errors.name, words) : undefined} />
      <Field
        label={t("setup.programmes.affiliation")}
        hint={t("setup.programmes.affiliationHint")}
        value={affiliation}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => setAffiliation(event.target.value)}
        error={errors.affiliation ? t(errors.affiliation, words) : undefined}
      />
      {withGrading ? (
        <Select
          label={t("setup.programmes.grading")}
          hint={t("setup.programmes.gradingHint")}
          value={policy ?? ""}
          onChange={(event) => setPolicy(event.target.value === "neb_gpa" || event.target.value === "percentage_division" ? event.target.value : null)}
          options={[
            { value: "", label: t(POLICY_LABEL.none) },
            { value: "neb_gpa", label: t(POLICY_LABEL.neb_gpa) },
            { value: "percentage_division", label: t(POLICY_LABEL.percentage_division) },
          ]}
        />
      ) : null}
      <div className={styles.formActions}>
        {children}
        <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Switch a programme or level off (or back on), from inside its Edit or options pop-up. Nothing is deleted. */
function SwitchButton({ active, name, onSwitch }: { active: boolean; name: string; onSwitch: () => Promise<boolean> }) {
  const [working, setWorking] = useState(false);
  return (
    <Button
      variant="quiet"
      loading={working}
      loadingLabel={t("setup.working")}
      aria-label={t(active ? "setup.programmes.switchOffItem" : "setup.programmes.switchOnItem", { name })}
      onClick={async () => {
        setWorking(true);
        await onSwitch();
        setWorking(false);
      }}
    >
      {t(active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
    </Button>
  );
}

/**
 * Delete, inside an Edit or options pop-up (D-097). Offered only when nothing is attached; it then asks once more,
 * because it cannot be undone. When something is attached, it says why it cannot be deleted and what to do instead.
 */
export function DeleteControl({ name, canDelete, blocked, onDelete }: { name: string; canDelete: boolean; blocked?: MessageKey; onDelete: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  if (!canDelete) return blocked ? <p className={styles.deleteNote}>{t(blocked)}</p> : null;
  if (!confirming)
    return (
      <div className={styles.deleteRow}>
        <Button variant="quiet" aria-label={t("structure.deleteItem", { name })} onClick={() => setConfirming(true)}>
          {t("structure.delete")}
        </Button>
      </div>
    );
  return (
    <div className={styles.confirm} role="group" aria-label={t("structure.deleteItem", { name })}>
      <p className={styles.confirmText}>{t("structure.deleteConfirm", { name })}</p>
      <div className={styles.formActions}>
        <Button variant="quiet" onClick={() => setConfirming(false)}>
          {t("structure.keep")}
        </Button>
        <Button
          variant="secondary"
          loading={working}
          loadingLabel={t("setup.working")}
          onClick={async () => {
            setWorking(true);
            const deleted = await onDelete();
            setWorking(false);
            if (!deleted) setConfirming(false);
          }}
        >
          {t("structure.deleteYes", { name })}
        </Button>
      </div>
    </div>
  );
}

// --- The hierarchy ---------------------------------------------------------------------------------------

function LevelRow({ level, words, student, canManage, actions }: { level: Level; words: Words; student: string; canManage: boolean; actions: StructureActions }) {
  return (
    <li className={styles.level} data-off={!level.active}>
      <Tile icon={BookOpen} tone="primary" size="small" />
      <span className={styles.levelName}>{level.name}</span>
      <span className={styles.meta}>{studentsText(level.students, student)}</span>
      {level.active ? null : <Badge>{t("setup.programmes.off")}</Badge>}
      {canManage ? (
        <span className={styles.rowEnd}>
          <AddDialog
            label={t("structure.levelOptions", { name: level.name })}
            title={level.name}
            variant="quiet"
            icon={<MoreVertical aria-hidden className={styles.moreIcon} />}
            hideLabel
          >
            {(close) => (
              <>
                <DialogFailure />
                <NameForm
                  label={t("setup.programmes.levelName", words)}
                  initial={level.name}
                  submitLabel={t("structure.saveName")}
                  required={t("structure.nameRequired")}
                  onSave={async (name) => (await actions.renameLevel(level, name)) && (close(), true)}
                >
                  <SwitchButton active={level.active} name={level.name} onSwitch={async () => (await actions.setLevelActive(level, !level.active)) && (close(), true)} />
                </NameForm>
                <DeleteControl name={level.name} canDelete={level.canDelete} blocked="structure.levelInUse" onDelete={async () => (await actions.deleteLevel(level)) && (close(), true)} />
              </>
            )}
          </AddDialog>
        </span>
      ) : null}
    </li>
  );
}

function ProgrammeCard({ programme, index, open, onToggle, words, student, canManage, actions }: { programme: Programme; index: number; open: boolean; onToggle: () => void; words: Words; student: string; canManage: boolean; actions: StructureActions }) {
  const bodyId = useId();
  const levelsOn = programme.levels.filter((l) => l.active).length;
  return (
    <li className={styles.programme} data-open={open}>
      <div className={styles.programmeHead}>
        <Tile icon={BookOpen} tone={toneAt(index + 1)} />
        <div className={styles.headText}>
          <div className={styles.titleLine}>
            <h3 className={styles.programmeName}>{programme.name}</h3>
            <Badge tone="ok">{programme.affiliation}</Badge>
            {programme.active ? null : <Badge>{t("setup.programmes.off")}</Badge>}
          </div>
          <p className={styles.meta}>
            {levelsText(levelsOn, words.level)} · {studentsText(programme.students, student)} · {t(POLICY_LABEL[programme.gradingPolicy ?? "none"])}
          </p>
        </div>
        <div className={styles.headActions}>
          {canManage ? (
            <AddDialog label={t("structure.edit")} ariaLabel={t("structure.editItem", { name: programme.name })} title={t("structure.editTitle", { name: programme.name })} variant="secondary" plus={false}>
              {(close) => (
                <>
                  <DialogFailure />
                  <ProgrammeFields words={words} initial={programme} withGrading submitLabel={t("structure.saveChanges")} onSave={async (values) => (await actions.editProgramme(programme, values)) && (close(), true)}>
                    <SwitchButton active={programme.active} name={programme.name} onSwitch={async () => (await actions.setProgrammeActive(programme, !programme.active)) && (close(), true)} />
                  </ProgrammeFields>
                  <DeleteControl name={programme.name} canDelete={programme.canDelete} blocked="structure.programmeInUse" onDelete={async () => (await actions.deleteProgramme(programme)) && (close(), true)} />
                </>
              )}
            </AddDialog>
          ) : null}
          <Disclosure open={open} controls={bodyId} name={programme.name} onToggle={onToggle} />
        </div>
      </div>
      {open ? (
        <div id={bodyId} className={styles.body}>
          <div className={styles.bodyHead}>
            <h4 className={styles.bodyTitle}>{t("structure.levelsTitle", words)}</h4>
            {canManage && programme.active ? (
              <AddDialog label={t("setup.programmes.addLevel", words)} title={t("structure.addLevelTo", { ...words, name: programme.name })} variant="secondary">
                {(close) => (
                  <>
                    <DialogFailure />
                    <NameForm
                    label={t("setup.programmes.levelName", words)}
                    hint={t("structure.levelHint")}
                    submitLabel={t("setup.programmes.addLevel", words)}
                    required={t("structure.nameRequired")}
                    onSave={async (name) => (await actions.addLevel(programme, name)) && (close(), true)}
                  />
                  </>
                )}
              </AddDialog>
            ) : null}
          </div>
          {programme.levels.length === 0 ? (
            <p className={styles.empty}>{t("structure.noLevels", words)}</p>
          ) : (
            <ul className={styles.levels} aria-label={t("setup.programmes.levelsOf", { ...words, name: programme.name })}>
              {programme.levels.map((level) => (
                <LevelRow key={level.id} level={level} words={words} student={student} canManage={canManage} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

function SectionCard({ section, index, programmes, open, isOpen, onToggle, words, student, canManage, actions }: { section: Section; index: number; programmes: Programme[]; open: boolean; isOpen: (id: string) => boolean; onToggle: (id: string) => void; words: Words; student: string; canManage: boolean; actions: StructureActions }) {
  const bodyId = useId();
  const on = programmes.filter((p) => p.active);
  const levels = on.reduce((n, p) => n + p.levels.filter((l) => l.active).length, 0);
  const students = programmes.reduce((n, p) => n + p.students, 0);
  return (
    <article className={styles.section} aria-labelledby={`${bodyId}-name`} data-open={open}>
      <div className={styles.sectionHead}>
        <Tile icon={GraduationCap} tone={toneAt(index)} />
        <div className={styles.headText}>
          <div className={styles.titleLine}>
            <h2 id={`${bodyId}-name`} className={styles.sectionName}>
              {section.name}
            </h2>
            {section.active ? null : <Badge>{t("setup.programmes.off")}</Badge>}
          </div>
          <p className={styles.meta}>
            {programmesText(on.length, words.programme)} · {levelsText(levels, words.level)} · {studentsText(students, student)}
            {section.receiptCode ? ` · ${t("setup.sections.receiptCodeMeta", { code: section.receiptCode })}` : ""}
          </p>
        </div>
        <div className={styles.headActions}>
          {canManage ? (
            <AddDialog label={t("structure.edit")} ariaLabel={t("structure.editItem", { name: section.name })} title={t("structure.editTitle", { name: section.name })} variant="secondary" plus={false}>
              {(close) => (
                <>
                  <DialogFailure />
                  <SectionForm words={words} initial={section} submitLabel={t("structure.saveSection")} onSave={async (values) => (await actions.editSection(section, values)) && (close(), true)}>
                    <SwitchButton active={section.active} name={section.name} onSwitch={async () => (await actions.setSectionActive(section, !section.active)) && (close(), true)} />
                  </SectionForm>
                  <DeleteControl name={section.name} canDelete={section.canDelete} blocked="structure.sectionInUse" onDelete={async () => (await actions.deleteSection(section)) && (close(), true)} />
                </>
              )}
            </AddDialog>
          ) : null}
          <Disclosure open={open} controls={bodyId} name={section.name} onToggle={() => onToggle(section.key)} />
        </div>
      </div>
      {open ? (
        <div id={bodyId} className={styles.body}>
          <div className={styles.bodyHead}>
            <h3 className={styles.bodyTitle}>{t("structure.programmesTitle", words)}</h3>
            {canManage && section.active ? (
              <AddDialog label={t("setup.programmes.add", words)} title={t("structure.addProgrammeTo", { ...words, name: section.name })} variant="secondary">
                {(close) => (
                  <>
                    <DialogFailure />
                    <ProgrammeFields words={words} withGrading={false} submitLabel={t("setup.programmes.add", words)} onSave={async (values) => (await actions.addProgramme(section.key, values)) && (close(), true)} />
                  </>
                )}
              </AddDialog>
            ) : null}
          </div>
          {programmes.length === 0 ? (
            <p className={styles.empty}>{t("structure.noProgrammes", { ...inSentence(words), programme: words.programme })}</p>
          ) : (
            <ul className={styles.programmes}>
              {programmes.map((programme, i) => (
                <ProgrammeCard key={programme.id} programme={programme} index={i} open={isOpen(programme.id)} onToggle={() => onToggle(programme.id)} words={words} student={student} canManage={canManage} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

function Totals({ totals, words, student }: { totals: Structure["totals"]; words: Words; student: string }) {
  const cards: { icon: LucideIcon; tone: Tone; label: string; value: number }[] = [
    { icon: Layers, tone: "accent", label: t("structure.totalSections", words), value: totals.sections },
    { icon: BookOpen, tone: "primary", label: t("structure.totalProgrammes", words), value: totals.programmes },
    { icon: Database, tone: "ok", label: t("structure.totalLevels", words), value: totals.levels },
    { icon: Users, tone: "warn", label: t("structure.totalStudents", { student }), value: totals.students },
  ];
  return (
    <dl className={styles.totals}>
      {cards.map((card) => (
        <div key={card.label} className={styles.total}>
          <Tile icon={card.icon} tone={card.tone} />
          <div className={styles.totalText}>
            <dt className={styles.totalLabel}>{card.label}</dt>
            <dd className={styles.totalValue}>{count(card.value)}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** The page once its data is here. Pure, so it is drawn in tests without a network. The first section and its first programme start open. */
export function AcademicStructureView({ data, canManage, actions }: { data: Structure; canManage: boolean; actions: StructureActions }) {
  const { term } = useConfig();
  const words = termWords(term);
  const student = term("role.student");
  const first = data.sections[0]?.key;
  const firstProgramme = data.programmes.find((p) => p.section.key === first)?.id;
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => toggled[id] ?? (id === first || id === firstProgramme);
  const toggle = useCallback((id: string) => setToggled((now) => ({ ...now, [id]: !(now[id] ?? (id === first || id === firstProgramme)) })), [first, firstProgramme]);

  return (
    <>
      <Totals totals={data.totals} words={words} student={student} />
      {data.sections.length === 0 ? (
        <div className={styles.emptyCard}>
          <Tile icon={Layers} tone="accent" />
          <h2 className={styles.sectionName}>{t("structure.emptyTitle", words)}</h2>
          <p className={styles.meta}>{t(canManage ? "structure.emptyBody" : "structure.emptyReadOnly", inSentence(words))}</p>
        </div>
      ) : (
        <div className={styles.sections}>
          {data.sections.map((section, index) => (
            <SectionCard
              key={section.key}
              section={section}
              index={index}
              programmes={data.programmes.filter((p) => p.section.key === section.key)}
              open={isOpen(section.key)}
              isOpen={isOpen}
              onToggle={toggle}
              words={words}
              student={student}
              canManage={canManage}
              actions={actions}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The shape of the page while it loads: four figures, then two sections. */
function StructureSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t("structure.loading")}</span>
      <div className={styles.totals} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.total}>
            <Skeleton width="3rem" height="3rem" />
            <div className={styles.totalText}>
              <Skeleton width="60%" />
              <Skeleton width="40%" height="1.75rem" />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.sections} aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className={styles.section}>
            <div className={styles.sectionHead}>
              <Skeleton width="3rem" height="3rem" />
              <div className={styles.headText}>
                <Skeleton width="40%" height="1.5rem" />
                <Skeleton width="30%" />
              </div>
            </div>
            <div className={styles.body}>
              <Skeleton height="4.5rem" />
              <Skeleton height="3rem" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- The screen --------------------------------------------------------------------------------------------

export function ProgrammesScreen() {
  const { api, me } = useSession();
  const { term, retry } = useConfig();
  const words = termWords(term);
  const canManage = canManageProgrammes(me?.roles ?? []); // the Admin's (D-087, D-095); others look only
  const load = useCallback(() => loadProgrammes(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [failure, setFailure] = useState<{ text: string; at: number } | null>(null);
  // `?add=1` (the dashboard's Add Program, D-089) opens Add a Section when the school has none yet.
  const search = useAddressQuery();
  const askedToAdd = search !== null && new URLSearchParams(search).get("add") === "1";

  /** Runs one change, says how it went, and on success reads the structure again so every count is right. */
  const run = useCallback(
    async (result: Promise<WriteResult | { ok: true; id: string } | { ok: false; reason: keyof typeof REASON_MESSAGE }>, done: MessageKey, refreshConfig = false) => {
      setFlash(null);
      const outcome = await result;
      setFlash(outcome.ok ? { tone: "ok", text: t(done) } : { tone: "bad", text: t(REASON_MESSAGE[outcome.reason]) });
      setFailure(outcome.ok ? null : { text: t(REASON_MESSAGE[outcome.reason]), at: Date.now() });
      if (outcome.ok) {
        await reload();
        if (refreshConfig) retry(); // other screens read the sections from the school's configuration
      }
      return outcome.ok;
    },
    [reload, retry],
  );

  const actions: StructureActions = {
    addSection: (values) => run(createSection(api, values.name, values.receiptCode), "setup.done.sectionAdded", true),
    editSection: (section, values) => {
      const changes = {
        ...(values.name !== section.name ? { name: values.name } : {}),
        ...(values.receiptCode && values.receiptCode !== section.receiptCode ? { receiptCode: values.receiptCode } : {}),
      };
      return run(updateSection(api, section.key, changes), changes.name ? "setup.done.sectionRenamed" : "structure.done.saved", true);
    },
    addProgramme: (sectionKey, values) => run(createProgramme(api, { ...values, sectionKey }), "setup.done.added"),
    editProgramme: (programme, values) => run(updateProgramme(api, programme.id, values), "structure.done.saved"),
    setProgrammeActive: (programme, active) => run(setProgrammeActive(api, programme.id, active), active ? "setup.done.switchedOn" : "setup.done.switchedOff"),
    addLevel: (programme, name) => run(addLevel(api, programme.id, name), "setup.done.added"),
    renameLevel: (level, name) => run(renameLevel(api, level.id, name), "structure.done.saved"),
    setLevelActive: (level, active) => run(setLevelActive(api, level.id, active), active ? "setup.done.switchedOn" : "setup.done.switchedOff"),
    setSectionActive: (section, active) => run(setSectionActive(api, section.key, active), active ? "setup.done.switchedOn" : "setup.done.switchedOff", true),
    deleteSection: (section) => run(deleteSection(api, section.key), "structure.done.deleted", true),
    deleteProgramme: (programme) => run(deleteProgramme(api, programme.id), "structure.done.deleted"),
    deleteLevel: (level) => run(deleteLevel(api, level.id), "structure.done.deleted"),
  };

  const none = view.status === "ready" && view.data.sections.length === 0;
  return (
    <FailureContext.Provider value={failure}>
    <div className={styles.page}>
      <TitleRow>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t("structure.title")}</h1>
          <p className={styles.subtitle}>{t("structure.subtitle", inSentence(words))}</p>
        </div>
        {canManage ? (
          <AddDialog label={t("setup.sections.add", words)} title={t("setup.sections.add", words)} openNow={askedToAdd && none}>
            {(close) => (
              <>
                <DialogFailure />
                <SectionForm words={words} submitLabel={t("setup.sections.add", words)} onSave={async (values) => (await actions.addSection(values)) && (close(), true)} />
              </>
            )}
          </AddDialog>
        ) : null}
      </TitleRow>
      {flash ? (
        <div aria-live="polite">
          <Notice tone={flash.tone}>{flash.text}</Notice>
        </div>
      ) : null}
      {view.status === "loading" ? <StructureSkeleton /> : null}
      {view.status === "failed" ? (
        <Notice tone="bad">
          <span className={styles.failed}>
            {t("structure.loadFailed")}
            <Button variant="secondary" onClick={() => void reload()}>
              {t("setup.retry")}
            </Button>
          </span>
        </Notice>
      ) : null}
      {view.status === "forbidden" ? <Notice tone="bad">{t("setup.forbidden")}</Notice> : null}
      {view.status === "ready" ? <AcademicStructureView data={view.data} canManage={canManage} actions={actions} /> : null}
      {canManage ? null : <Notice>{t("setup.programmes.readOnly", { admin: term("role.admin") })}</Notice>}
    </div>
    </FailureContext.Provider>
  );
}
