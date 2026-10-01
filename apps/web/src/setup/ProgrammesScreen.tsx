"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import {
  AddDialog,
  Badge,
  Button,
  Card,
  Field,
  Notice,
  Select,
  TitleRow,
} from "@/ui";

import {
  addLevel,
  createProgramme,
  createSection,
  loadProgrammes,
  renameSection,
  setLevelActive,
  setProgrammeActive,
  setProgrammePolicy,
} from "./client";
import {
  REASON_MESSAGE,
  canManageProgrammes,
  termWords,
  type Level,
  type Programme,
} from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

function LevelAdder({
  programme,
  onAdd,
}: {
  programme: Programme;
  onAdd: (programme: Programme, name: string) => Promise<boolean>;
}) {
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    const added = await onAdd(programme, name.trim());
    setSaving(false);
    if (added) setName("");
  }

  return (
    <form onSubmit={submit} noValidate className={styles.inline}>
      <Field
        label={t("setup.programmes.levelName", words)}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        variant="secondary"
        loading={saving}
        loadingLabel={t("setup.working")}
      >
        {t("setup.programmes.addLevel", words)}
      </Button>
    </form>
  );
}

export interface ProgrammesViewProps {
  programmes: readonly Programme[];
  canManage: boolean;
  busy: string | null;
  onToggleProgramme: (programme: Programme) => void;
  onToggleLevel: (level: Level, programme: Programme) => void;
  onAddLevel: (programme: Programme, name: string) => Promise<boolean>;
  /** Sets the programme's grading policy (Phase 7, D-079); without it, its classes' results cannot be published. */
  onSetPolicy?: (
    programme: Programme,
    policy: Programme["gradingPolicy"],
  ) => void;
}

const POLICY_LABEL: Record<
  NonNullable<Programme["gradingPolicy"]> | "none",
  MessageKey
> = {
  none: "setup.grading.none",
  neb_gpa: "setup.grading.neb",
  percentage_division: "setup.grading.percentage",
};

/** Each programme with its levels in order. Switching off keeps the history; nothing is deleted. */
export function ProgrammesView({
  programmes,
  canManage,
  busy,
  onToggleProgramme,
  onToggleLevel,
  onAddLevel,
  onSetPolicy,
}: ProgrammesViewProps) {
  const { term } = useConfig();
  const words = termWords(term);
  if (programmes.length === 0)
    return <p className={styles.empty}>{t("setup.programmes.empty", words)}</p>;

  return (
    <ul className={styles.list}>
      {programmes.map((programme) => (
        <li key={programme.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{programme.name}</h2>
          <div className={styles.badges}>
            <Badge>{programme.section.name}</Badge>
            <Badge>{programme.affiliation}</Badge>
            {programme.active ? null : (
              <Badge>{t("setup.programmes.off")}</Badge>
            )}
            {canManage && onSetPolicy ? null : (
              <Badge>
                {t(POLICY_LABEL[programme.gradingPolicy ?? "none"])}
              </Badge>
            )}
          </div>
          {canManage && onSetPolicy ? (
            <Select
              label={t("setup.programmes.grading")}
              hint={t("setup.programmes.gradingHint")}
              value={programme.gradingPolicy ?? ""}
              disabled={busy !== null}
              onChange={(event) =>
                onSetPolicy(
                  programme,
                  event.target.value === "neb_gpa" ||
                    event.target.value === "percentage_division"
                    ? event.target.value
                    : null,
                )
              }
              options={[
                { value: "", label: t(POLICY_LABEL.none) },
                { value: "neb_gpa", label: t(POLICY_LABEL.neb_gpa) },
                {
                  value: "percentage_division",
                  label: t(POLICY_LABEL.percentage_division),
                },
              ]}
            />
          ) : null}

          {programme.levels.length === 0 ? (
            <p className={styles.muted}>
              {t("setup.programmes.noLevels", words)}
            </p>
          ) : (
            <ul
              className={styles.levels}
              aria-label={t("setup.programmes.levelsOf", {
                ...words,
                name: programme.name,
              })}
            >
              {programme.levels.map((level) => (
                <li key={level.id} className={styles.level}>
                  <span className={styles.levelName}>{level.name}</span>
                  {level.active ? null : (
                    <Badge>{t("setup.programmes.off")}</Badge>
                  )}
                  {canManage ? (
                    <Button
                      variant="quiet"
                      loading={busy === level.id}
                      loadingLabel={t("setup.working")}
                      disabled={busy !== null && busy !== level.id}
                      aria-label={t(
                        level.active
                          ? "setup.programmes.switchOffItem"
                          : "setup.programmes.switchOnItem",
                        { name: level.name },
                      )}
                      onClick={() => onToggleLevel(level, programme)}
                    >
                      {t(
                        level.active
                          ? "setup.programmes.switchOff"
                          : "setup.programmes.switchOn",
                      )}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <>
              {programme.active ? (
                <LevelAdder programme={programme} onAdd={onAddLevel} />
              ) : null}
              <div className={styles.actions}>
                <Button
                  variant="quiet"
                  loading={busy === programme.id}
                  loadingLabel={t("setup.working")}
                  disabled={busy !== null && busy !== programme.id}
                  aria-label={t(
                    programme.active
                      ? "setup.programmes.switchOffItem"
                      : "setup.programmes.switchOnItem",
                    { name: programme.name },
                  )}
                  onClick={() => onToggleProgramme(programme)}
                >
                  {t(
                    programme.active
                      ? "setup.programmes.switchOff"
                      : "setup.programmes.switchOn",
                  )}
                </Button>
              </div>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One name, for adding a section or renaming one (D-095). */
function SectionNameForm({
  initial = "",
  submitLabel,
  onSave,
}: {
  initial?: string;
  submitLabel: string;
  onSave: (name: string) => Promise<boolean>;
}) {
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState(initial);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError("setup.error.sectionNameRequired");
    setError(null);
    setSaving(true);
    const saved = await onSave(name.trim());
    setSaving(false);
    if (saved && !initial) setName("");
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field
        label={t("setup.sections.name", words)}
        hint={t("setup.sections.nameHint")}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        error={error ? t(error, words) : undefined}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * The school's sections (D-095): it starts with none, and the Admin adds them before the programmes under them.
 * Renaming keeps everything counted by the section (receipts, Top 20, who may see it). Nothing is deleted.
 */
export function SectionsCard({
  sections,
  canManage,
  prominent,
  onAdd,
  onRename,
}: {
  sections: readonly { key: string; name: string }[];
  canManage: boolean;
  /** The Add button is the page's prominent one only while there is no section yet (D-030: one per view). */
  prominent: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onRename: (key: string, name: string) => Promise<boolean>;
}) {
  const { term } = useConfig();
  const words = termWords(term);
  return (
    <Card aria-labelledby="sections-heading" className={styles.sections}>
      <div className={styles.sectionsHead}>
        <h2 id="sections-heading" className={styles.itemTitle}>
          {t("setup.sections.title", words)}
        </h2>
        {canManage ? (
          <AddDialog
            label={t("setup.sections.add", words)}
            title={t("setup.sections.add", words)}
            variant={prominent ? "primary" : "secondary"}
          >
            {(close) => (
              <SectionNameForm
                submitLabel={t("setup.sections.add", words)}
                onSave={async (name) => (await onAdd(name)) && (close(), true)}
              />
            )}
          </AddDialog>
        ) : null}
      </div>
      <p className={styles.muted}>{t("setup.sections.intro", words)}</p>
      {sections.length === 0 ? (
        <p className={styles.empty}>{t("setup.sections.empty", words)}</p>
      ) : (
        <ul
          className={styles.levels}
          aria-label={t("setup.sections.title", words)}
        >
          {sections.map((section) => (
            <li key={section.key} className={styles.level}>
              <span className={styles.levelName}>{section.name}</span>
              {canManage ? (
                <AddDialog
                  label={t("setup.sections.rename")}
                  ariaLabel={t("setup.sections.renameItem", {
                    name: section.name,
                  })}
                  title={t("setup.sections.renameTitle", {
                    name: section.name,
                  })}
                  variant="quiet"
                  plus={false}
                >
                  {(close) => (
                    <SectionNameForm
                      initial={section.name}
                      submitLabel={t("setup.sections.save")}
                      onSave={async (name) =>
                        (await onRename(section.key, name)) && (close(), true)
                      }
                    />
                  )}
                </AddDialog>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProgrammeForm({
  sections,
  onAdded,
  onProblem,
  showTitle = true,
}: {
  sections: readonly { key: string; name: string }[];
  onAdded: () => void;
  onProblem: (key: MessageKey) => void;
  showTitle?: boolean;
}) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [sectionKey, setSectionKey] = useState(
    sections.length === 1 ? sections[0]!.key : "",
  );
  const [errors, setErrors] = useState<{
    name?: MessageKey;
    affiliation?: MessageKey;
    section?: MessageKey;
  }>({});
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) =>
    key ? t(key, words) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found: typeof errors = {};
    if (!name.trim()) found.name = "setup.error.nameRequired";
    if (!affiliation.trim())
      found.affiliation = "setup.error.affiliationRequired";
    if (!sectionKey) found.section = "setup.error.sectionRequired";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = await createProgramme(api, {
      name: name.trim(),
      sectionKey,
      affiliation: affiliation.trim(),
    });
    setSaving(false);
    if (result.ok) {
      setName("");
      setAffiliation("");
      onAdded();
    } else {
      onProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? (
        <h2 className={styles.formTitle}>{t("setup.programmes.add", words)}</h2>
      ) : null}
      <Field
        label={t("setup.programmes.name")}
        value={name}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        error={say(errors.name)}
      />
      <Select
        label={t("setup.programmes.section", words)}
        value={sectionKey}
        onChange={(event) => setSectionKey(event.target.value)}
        options={[
          { value: "", label: t("setup.programmes.choose") },
          ...sections.map((s) => ({ value: s.key, label: s.name })),
        ]}
        error={say(errors.section)}
      />
      <Field
        label={t("setup.programmes.affiliation")}
        hint={t("setup.programmes.affiliationHint")}
        value={affiliation}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => setAffiliation(event.target.value)}
        error={say(errors.affiliation)}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.programmes.add", words)}
      </Button>
    </form>
  );
}

export function ProgrammesScreen() {
  const { api, me } = useSession();
  const { config, term, retry } = useConfig();
  const roles = me?.roles ?? [];
  // Programmes and their levels are the Admin's (D-087): every section is theirs, and no Co-ordinator changes them.
  const canManage = canManageProgrammes(roles);
  // The sections come with the programmes, fresh from the server: a section just added shows at once (D-095).
  const configSections = config?.sections ?? [];
  const words = termWords(term);
  // `?add=1` (the dashboard's Add Program, D-089) opens the Add pop-up straight away.
  const search = useAddressQuery();
  const askedToAdd =
    search !== null && new URLSearchParams(search).get("add") === "1";
  const load = useCallback(() => loadProgrammes(api), [api]);
  const { view, reload } = useLoad(load);
  const sections = canManage
    ? view.status === "ready"
      ? view.data.sections
      : configSections
    : [];
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const said = (
    result: { ok: true } | { ok: false; reason: keyof typeof REASON_MESSAGE },
    done: MessageKey,
  ) =>
    setFlash(
      result.ok
        ? { tone: "ok", text: t(done) }
        : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) },
    );

  async function toggle(
    id: string,
    run: () => ReturnType<typeof setProgrammeActive>,
    done: MessageKey,
  ) {
    if (busy) return;
    setBusy(id);
    setFlash(null);
    const result = await run();
    setBusy(null);
    said(result, done);
    await reload();
  }

  async function addSection(name: string): Promise<boolean> {
    setFlash(null);
    const result = await createSection(api, name);
    said(result, "setup.done.sectionAdded");
    if (result.ok) {
      await reload();
      retry(); // other screens read the sections from the school's configuration
    }
    return result.ok;
  }

  async function rename(key: string, name: string): Promise<boolean> {
    setFlash(null);
    const result = await renameSection(api, key, name);
    said(result, "setup.done.sectionRenamed");
    if (result.ok) {
      await reload();
      retry();
    }
    return result.ok;
  }

  async function add(programme: Programme, name: string): Promise<boolean> {
    setFlash(null);
    const result = await addLevel(api, programme.id, name);
    said(result, "setup.done.added");
    if (result.ok) await reload();
    return result.ok;
  }

  return (
    <>
      <TitleRow>
        <h1 className={styles.title}>{t("setup.programmes.title", words)}</h1>
        {canManage && sections.length > 0 ? (
          <AddDialog
            label={t("setup.programmes.add", words)}
            title={t("setup.programmes.add", words)}
            openNow={askedToAdd && view.status === "ready"}
          >
            {(close) => (
              <ProgrammeForm
                sections={sections}
                showTitle={false}
                onAdded={() => {
                  close();
                  setFlash({ tone: "ok", text: t("setup.done.added") });
                  void reload();
                }}
                onProblem={(key) => setFlash({ tone: "bad", text: t(key) })}
              />
            )}
          </AddDialog>
        ) : null}
      </TitleRow>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ programmes, sections: listed }) => (
          <>
            <SectionsCard
              sections={listed}
              canManage={canManage}
              prominent={listed.length === 0}
              onAdd={addSection}
              onRename={rename}
            />
            {canManage && listed.length === 0 ? null : (
              <ProgrammesView
                programmes={programmes}
                canManage={canManage}
                busy={busy}
                onToggleProgramme={(p) =>
                  void toggle(
                    p.id,
                    () => setProgrammeActive(api, p.id, !p.active),
                    p.active
                      ? "setup.done.switchedOff"
                      : "setup.done.switchedOn",
                  )
                }
                onToggleLevel={(l) =>
                  void toggle(
                    l.id,
                    () => setLevelActive(api, l.id, !l.active),
                    l.active
                      ? "setup.done.switchedOff"
                      : "setup.done.switchedOn",
                  )
                }
                onAddLevel={add}
                onSetPolicy={(p, policy) =>
                  void toggle(
                    p.id,
                    () => setProgrammePolicy(api, p.id, policy),
                    "setup.done.gradingSet",
                  )
                }
              />
            )}
          </>
        )}
      </Gate>
      {canManage ? null : (
        <Notice>
          {t("setup.programmes.readOnly", { admin: term("role.admin") })}
        </Notice>
      )}
    </>
  );
}
