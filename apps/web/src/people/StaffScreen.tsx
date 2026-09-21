"use client";

import { useCallback, useId, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { manageableSections, type RoleView } from "@/setup/model";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, CopyButton, Field, Notice, Select } from "@/ui";

import { createStaff, createTeacher, issueTemporaryPassword, loadStaff, setStaffActive } from "./client";
import { REASON_MESSAGE, addableRoles, canManageMember, validateStaffForm, type AddableRole, type StaffFormErrors, type StaffMember } from "./model";
import styles from "./people.module.css";

type Flash = { tone: "ok" | "bad"; text: string };
type Section = { key: string; name: string };

const roleTerm = (term: (key: string) => string, role: string) => term(`role.${role}`);
const sectionName = (sections: readonly Section[], key: string | null) => sections.find((s) => s.key === key)?.name ?? key ?? "";

// --- The one-time password ---------------------------------------------------------------------------

/**
 * A temporary password, shown once. It lives only in this screen's state: it is never in the address, in storage, or in
 * a log, and it is gone when the person leaves the screen or says they have noted it. There is no timer: a person who
 * needs longer to write it down is not hurried.
 */
export function TemporaryPasswordNotice({ name, password, onDone }: { name: string; password: string; onDone: () => void }) {
  const heading = useId();
  return (
    <section role="status" aria-labelledby={heading} className={styles.secret}>
      <h2 id={heading} className={setupStyles.formTitle}>
        {t("people.secret.title", { name })}
      </h2>
      <p className={styles.password} aria-label={t("people.secret.label")}>
        {password}
      </p>
      <p className={setupStyles.muted}>{t("people.secret.body", { name })}</p>
      <div className={setupStyles.actions}>
        <CopyButton text={password} label={t("people.secret.copy")} copiedLabel={t("people.secret.copied")} />
        <Button className={styles.wrapLabel} onClick={onDone}>
          {t("people.secret.done")}
        </Button>
      </div>
    </section>
  );
}

// --- The list ----------------------------------------------------------------------------------------

/** The staff the person may see, with the controls for the ones they may manage. */
export function StaffView({
  staff,
  roles,
  sections,
  busy,
  onToggle,
  onIssue,
}: {
  staff: readonly StaffMember[];
  roles: readonly RoleView[];
  sections: readonly Section[];
  busy: string | null;
  onToggle: (member: StaffMember) => void;
  onIssue: (member: StaffMember) => void;
}) {
  const { term } = useConfig();
  if (staff.length === 0) return <p className={setupStyles.empty}>{t("people.empty")}</p>;

  return (
    <ul className={setupStyles.list}>
      {staff.map((member) => {
        const first = member.roles[0];
        const scope = member.homeSection !== null ? sectionName(sections, member.homeSection) : first?.scope === "section" ? sectionName(sections, first.section) : t("people.wholeSchool");
        const manage = canManageMember(roles, member);
        return (
          <li key={member.id} className={setupStyles.item}>
            <h2 className={setupStyles.itemTitle}>{member.fullName}</h2>
            <p className={setupStyles.muted}>{member.email}</p>
            <div className={setupStyles.badges}>
              {member.roles.map((r) => (
                <Badge key={r.role}>{roleTerm(term, r.role)}</Badge>
              ))}
              <Badge>{scope}</Badge>
              {member.mustChangePassword ? <Badge>{t("people.neverSignedIn")}</Badge> : null}
              {member.active ? null : <Badge>{t("people.off")}</Badge>}
            </div>
            {manage ? (
              <div className={setupStyles.actions}>
                <Button
                  variant="quiet"
                  loading={busy === member.id}
                  loadingLabel={t("setup.working")}
                  disabled={busy !== null && busy !== member.id}
                  aria-label={t(member.active ? "people.switchOffItem" : "people.switchOnItem", { name: member.fullName })}
                  onClick={() => onToggle(member)}
                >
                  {t(member.active ? "people.switchOff" : "people.switchOn")}
                </Button>
                {member.active ? (
                  <Button
                    variant="quiet"
                    className={styles.wrapLabel}
                    disabled={busy !== null}
                    aria-label={t("people.newPasswordItem", { name: member.fullName })}
                    onClick={() => onIssue(member)}
                  >
                    {t("people.newPassword")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// --- The form ----------------------------------------------------------------------------------------

/** Adds a person. Someone who can add only one kind of person is not asked which; they are told which. */
export function StaffForm({ roles, sections, onCreated }: { roles: readonly RoleView[]; sections: readonly Section[]; onCreated: (name: string, password: string) => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const options = addableRoles(roles);
  const [role, setRole] = useState<AddableRole>(options[0] ?? "teacher");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sectionKey, setSectionKey] = useState("");
  const [errors, setErrors] = useState<StaffFormErrors>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key, { section: term("term.section") }) : undefined);

  const isTeacher = role === "teacher";
  const choices = isTeacher ? manageableSections(roles, sections) : sections;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    const values = { fullName, email, phone, role, sectionKey };
    const found = validateStaffForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = isTeacher ? await createTeacher(api, values) : await createStaff(api, { ...values, role: role as "coordinator" | "accountant" });
    setSaving(false);
    if (result.ok) {
      onCreated(fullName.trim(), result.temporaryPassword);
      setFullName("");
      setEmail("");
      setPhone("");
      setSectionKey("");
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={setupStyles.form}>
      <h2 className={setupStyles.formTitle}>{t("people.add")}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      {options.length > 1 ? (
        <Select
          label={t("people.role")}
          value={role}
          onChange={(event) => {
            setRole(event.target.value as AddableRole);
            setSectionKey("");
          }}
          options={options.map((r) => ({ value: r, label: roleTerm(term, r) }))}
        />
      ) : (
        <p className={setupStyles.muted}>{t("people.roleFixed", { role: roleTerm(term, role) })}</p>
      )}
      <Field label={t("people.fullName")} value={fullName} maxLength={120} autoComplete="off" onChange={(event) => setFullName(event.target.value)} error={say(errors.fullName)} />
      <Field
        label={t("people.email")}
        type="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={say(errors.email)}
      />
      <Field label={t("people.phone")} type="tel" inputMode="tel" autoComplete="off" value={phone} maxLength={30} onChange={(event) => setPhone(event.target.value)} error={say(errors.phone)} />
      <Select
        label={isTeacher ? t("people.homeSection") : t("people.section")}
        value={sectionKey}
        onChange={(event) => setSectionKey(event.target.value)}
        options={[{ value: "", label: isTeacher ? t("people.choose") : t("people.wholeSchool") }, ...choices.map((s) => ({ value: s.key, label: s.name }))]}
        error={say(errors.sectionKey)}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("people.add")}
      </Button>
    </form>
  );
}

// --- The screen --------------------------------------------------------------------------------------

export function StaffScreen() {
  const { api, me } = useSession();
  const { config } = useConfig();
  const roles = me?.roles ?? [];
  const sections = config?.sections ?? [];
  const load = useCallback(() => loadStaff(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(member: StaffMember) {
    if (busy) return;
    setBusy(member.id);
    setFlash(null);
    setSecret(null);
    const result = await setStaffActive(api, member.id, !member.active);
    setBusy(null);
    setFlash(
      result.ok
        ? { tone: "ok", text: t(member.active ? "people.done.switchedOff" : "people.done.switchedOn", { name: member.fullName }) }
        : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) },
    );
    await reload();
  }

  async function issue(member: StaffMember) {
    if (busy) return;
    setBusy(member.id);
    setFlash(null);
    setSecret(null);
    const result = await issueTemporaryPassword(api, member.id);
    setBusy(null);
    if (result.ok) setSecret({ name: member.fullName, password: result.temporaryPassword });
    else setFlash({ tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await reload();
  }

  return (
    <>
      <h1 className={setupStyles.title}>{t("people.title")}</h1>
      <p className={setupStyles.muted}>{t("people.intro")}</p>
      {secret ? <TemporaryPasswordNotice name={secret.name} password={secret.password} onDone={() => setSecret(null)} /> : null}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ staff }) => <StaffView staff={staff} roles={roles} sections={sections} busy={busy} onToggle={(m) => void toggle(m)} onIssue={(m) => void issue(m)} />}
      </Gate>
      {addableRoles(roles).length > 0 ? (
        <StaffForm
          roles={roles}
          sections={sections}
          onCreated={(name, password) => {
            setFlash(null);
            setSecret({ name, password });
            void reload();
          }}
        />
      ) : null}
    </>
  );
}
