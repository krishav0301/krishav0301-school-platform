"use client";

import { Check, UserCog, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { ROLE_BRIEFS } from "@/dashboard/RoleBrief";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Field, Notice } from "@/ui";

import { createPerson, setAccess, type PeoplePage, type Person } from "./access-client";
import { ADD_STEPS, STEP_LABEL, chosenSections, emptyAdd, initials, scopeWords, signInLine, validateStep, type AddErrors, type AddStep, type AddValues } from "./access-model";
import { REASON_MESSAGE } from "./model";
import { TemporaryPasswordNotice } from "./StaffScreen";
import styles from "./people-access.module.css";

type Section = PeoplePage["sections"][number];

/** The browser's own modal dialog: focus moves in and stays in, Escape closes it, the page behind is inert. */
function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.dialogHead}>
        <div>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          {subtitle ? <p className={styles.muted}>{subtitle}</p> : null}
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t("ui.close")}>
          <X aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const ROLE_CARD: Record<"coordinator" | "accountant", { icon: LucideIcon; tone: string; body: MessageKey }> = {
  coordinator: { icon: UserCog, tone: "accent", body: "access.role.coordinatorBody" },
  accountant: { icon: Wallet, tone: "ok", body: "access.role.accountantBody" },
};

/** What a role can do, in the words of its home-page brief (D-092): plain language, never permission ids. */
export function RoleCan({ role }: { role: "coordinator" | "accountant" }) {
  const { config, term } = useConfig();
  const brief = ROLE_BRIEFS[role];
  const switchedOn = (module?: string) => !module || config?.modules[module] !== false;
  return (
    <div className={styles.can}>
      <p className={styles.canTitle}>{t("access.canTitle", { role: term(`role.${role}`) })}</p>
      <ul className={styles.canList}>
        {brief.lines.filter((line) => switchedOn(line.module)).map((line) => (
          <li key={line.title}>
            <Check aria-hidden />
            {t(line.title)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whole school, or some switched-on sections, as a choice. */
function ScopeChoice({
  sections,
  wholeSchool,
  sectionKeys,
  error,
  onChange,
}: {
  sections: readonly Section[];
  wholeSchool: boolean;
  sectionKeys: string[];
  error?: MessageKey;
  onChange: (next: { wholeSchool: boolean; sectionKeys: string[] }) => void;
}) {
  const name = useId();
  const usable = sections.filter((s) => s.active);
  return (
    <fieldset className={styles.scope}>
      <legend className={styles.legend}>{t("access.scope")}</legend>
      <label className={styles.choice}>
        <input type="radio" name={name} checked={wholeSchool} onChange={() => onChange({ wholeSchool: true, sectionKeys })} />
        <span>
          <span className={styles.choiceTitle}>{t("people.wholeSchool")}</span>
          <span className={styles.muted}>{t("access.scope.wholeHint")}</span>
        </span>
      </label>
      <label className={styles.choice}>
        <input type="radio" name={name} checked={!wholeSchool} disabled={usable.length === 0} onChange={() => onChange({ wholeSchool: false, sectionKeys })} />
        <span>
          <span className={styles.choiceTitle}>{t("access.scope.sections")}</span>
          <span className={styles.muted}>{usable.length === 0 ? t("access.scope.noSections") : t("access.scope.sectionsHint")}</span>
        </span>
      </label>
      {!wholeSchool ? (
        <div className={styles.sectionList} role="group" aria-label={t("access.scope.sections")}>
          {usable.map((s) => (
            <label key={s.key} className={styles.check}>
              <input
                type="checkbox"
                checked={sectionKeys.includes(s.key)}
                onChange={(event) => onChange({ wholeSchool: false, sectionKeys: event.target.checked ? [...sectionKeys, s.key] : sectionKeys.filter((k) => k !== s.key) })}
              />
              {s.name}
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      ) : null}
    </fieldset>
  );
}

// --- Add a person ----------------------------------------------------------------------------------

/**
 * "Add a person" (D-099, after the PM's reference): the Principal gives someone administrative access. Only a
 * Co-ordinator or an Accountant: teachers are added by Co-ordinators. Four short steps: role, who, where their access
 * reaches, and a last look at what they will be able to do. Nothing typed is lost if creating fails; the one-time
 * temporary password is shown once, here, and nowhere else.
 */
export function AddPersonDialog({ sections, onClose, onCreated }: { sections: readonly Section[]; onClose: () => void; onCreated: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const [step, setStep] = useState<AddStep>("role");
  const [values, setValues] = useState<AddValues>(emptyAdd);
  const [errors, setErrors] = useState<AddErrors>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const at = ADD_STEPS.indexOf(step);

  const set = (patch: Partial<AddValues>) => setValues((v) => ({ ...v, ...patch }));

  function next() {
    const problems = validateStep(step, values);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setStep(ADD_STEPS[at + 1]!);
  }

  async function create() {
    if (busy || values.role === null) return;
    setBusy(true);
    setFailure(null);
    const result = await createPerson(api, { role: values.role, fullName: values.fullName, email: values.email, phone: values.phone, sectionKeys: chosenSections(values) });
    setBusy(false);
    if (result.ok) {
      setSecret({ name: values.fullName.trim(), password: result.temporaryPassword });
      onCreated();
      return;
    }
    if (result.reason === "email_taken") {
      setErrors({ email: "people.error.emailTaken" });
      setStep("details");
      return;
    }
    setFailure(result.reason === "failed" ? "access.error.createFailed" : REASON_MESSAGE[result.reason]);
  }

  if (secret) {
    return (
      <Sheet title={t("access.add.title")} onClose={onClose}>
        <TemporaryPasswordNotice name={secret.name} password={secret.password} onDone={onClose} />
      </Sheet>
    );
  }

  const role = values.role;
  return (
    <Sheet title={t("access.add.title")} subtitle={t("access.add.subtitle")} onClose={onClose}>
      <ol className={styles.steps} aria-label={t("access.add.steps")}>
        {ADD_STEPS.map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined} data-done={i < at ? true : undefined}>
            {t(STEP_LABEL[s])}
          </li>
        ))}
      </ol>

      {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}

      {step === "role" ? (
        <fieldset className={styles.roleCards}>
          <legend className="sr-only">{t("people.role")}</legend>
          {(["coordinator", "accountant"] as const).map((r) => {
            const card = ROLE_CARD[r];
            const Icon = card.icon;
            return (
              <label key={r} className={styles.roleCard} data-checked={role === r ? true : undefined}>
                <input type="radio" name="role" className={styles.hiddenRadio} checked={role === r} onChange={() => set({ role: r })} />
                <span className={styles.tile} data-tone={card.tone} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.roleName}>{term(`role.${r}`)}</span>
                <span className={styles.muted}>{t(card.body)}</span>
                <span className={styles.radioMark} aria-hidden />
              </label>
            );
          })}
          {errors.role ? (
            <p className={styles.error} role="alert">
              {t(errors.role)}
            </p>
          ) : null}
          <p className={styles.note}>{t("access.add.teacherNote", { coordinator: term("role.coordinator") })}</p>
        </fieldset>
      ) : null}

      {step === "details" ? (
        <div className={styles.fields}>
          <Field label={t("people.fullName")} value={values.fullName} autoComplete="off" onChange={(e) => set({ fullName: e.target.value })} error={errors.fullName ? t(errors.fullName) : undefined} />
          <Field label={t("people.email")} type="email" value={values.email} autoComplete="off" onChange={(e) => set({ email: e.target.value })} error={errors.email ? t(errors.email) : undefined} />
          <Field label={t("people.phone")} type="tel" value={values.phone} autoComplete="off" onChange={(e) => set({ phone: e.target.value })} error={errors.phone ? t(errors.phone) : undefined} />
        </div>
      ) : null}

      {step === "access" ? (
        <ScopeChoice sections={sections} wholeSchool={values.wholeSchool} sectionKeys={values.sectionKeys} error={errors.sections} onChange={(next) => set(next)} />
      ) : null}

      {step === "review" && role ? (
        <div className={styles.review}>
          <dl className={styles.facts}>
            <div>
              <dt>{t("people.role")}</dt>
              <dd>{term(`role.${role}`)}</dd>
            </div>
            <div>
              <dt>{t("people.fullName")}</dt>
              <dd>{values.fullName.trim()}</dd>
            </div>
            <div>
              <dt>{t("people.email")}</dt>
              <dd>{values.email.trim()}</dd>
            </div>
            <div>
              <dt>{t("access.scope")}</dt>
              <dd>{values.wholeSchool ? t("people.wholeSchool") : sections.filter((s) => values.sectionKeys.includes(s.key)).map((s) => s.name).join(", ")}</dd>
            </div>
          </dl>
          <RoleCan role={role} />
          <p className={styles.note}>{t("access.add.passwordNote")}</p>
        </div>
      ) : null}

      <div className={styles.dialogActions}>
        {at === 0 ? (
          <Button variant="secondary" onClick={onClose}>
            {t("contentForm.cancel")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setStep(ADD_STEPS[at - 1]!)}>
            {t("access.back")}
          </Button>
        )}
        {step === "review" ? (
          <Button loading={busy} loadingLabel={t("access.creating")} onClick={() => void create()}>
            {t("access.create")}
          </Button>
        ) : (
          <Button onClick={next}>{t("access.next")}</Button>
        )}
      </div>
    </Sheet>
  );
}

// --- Manage access ---------------------------------------------------------------------------------

/**
 * "Manage access" for one Co-ordinator or Accountant (D-099): who they are, their role, where their access reaches
 * (changeable), what that lets them do, their account (switch off or on) and their sign-in, and a new temporary
 * password. Each change is saved on its own and audited by the server; the list is refreshed after.
 */
export function ManageAccessDialog({
  person,
  sections,
  now,
  onClose,
  onChanged,
  onToggle,
  onNewPassword,
}: {
  person: Person;
  sections: readonly Section[];
  now: Date;
  onClose: () => void;
  onChanged: (message: string) => void;
  onToggle: (person: Person) => void;
  onNewPassword: (person: Person) => void;
}) {
  const { api } = useSession();
  const { term } = useConfig();
  const role = person.role === "teacher" ? null : person.role;
  const [scope, setScope] = useState({ wholeSchool: person.sections.length === 0, sectionKeys: person.sections.map((s) => s.key) });
  const [error, setError] = useState<MessageKey | undefined>();
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const before = JSON.stringify(person.sections.map((s) => s.key).sort());
  const changed = scope.wholeSchool !== (person.sections.length === 0) || (!scope.wholeSchool && JSON.stringify([...scope.sectionKeys].sort()) !== before);

  async function save() {
    if (saving) return;
    if (!scope.wholeSchool && scope.sectionKeys.length === 0) return setError("access.error.sectionsRequired");
    setError(undefined);
    setFailure(null);
    setSaving(true);
    const result = await setAccess(api, person.id, chosenSections(scope));
    setSaving(false);
    if (result.ok) return onChanged(t("access.done.saved", { name: person.fullName }));
    setFailure(result.reason === "failed" ? "access.error.updateFailed" : REASON_MESSAGE[result.reason]);
  }

  return (
    <Sheet title={t("access.manage.title")} subtitle={t("access.manage.subtitle")} onClose={onClose}>
      <div className={styles.manage}>
        <div className={styles.who}>
          <span className={styles.avatar} aria-hidden>
            {initials(person.fullName)}
          </span>
          <span>
            <span className={styles.personName}>{person.fullName}</span>
            <span className={styles.muted}>{person.email}</span>
          </span>
        </div>

        {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}

        <dl className={styles.facts}>
          <div>
            <dt>{t("people.role")}</dt>
            <dd>{term(`role.${person.role}`)}</dd>
          </div>
          <div>
            <dt>{t("access.account")}</dt>
            <dd>
              <span className={styles.status} data-active={person.active}>
                <span className={styles.dot} aria-hidden />
                {t(person.active ? "access.active" : "people.off")}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t("access.signIn")}</dt>
            <dd>
              {signInLine(person.lastSignInAt, now)}
              {person.mustChangePassword ? <span className={styles.muted}>{t("access.mustChange")}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{t("access.scopeNow")}</dt>
            <dd>{scopeWords(person)}</dd>
          </div>
        </dl>

        {role ? (
          <>
            <ScopeChoice sections={sections} wholeSchool={scope.wholeSchool} sectionKeys={scope.sectionKeys} error={error} onChange={setScope} />
            <p className={styles.note}>{t("access.manage.whenNote")}</p>
            <RoleCan role={role} />
          </>
        ) : null}

        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => onToggle(person)}>
            {t(person.active ? "people.switchOff" : "people.switchOn")}
          </Button>
          {person.active ? (
            <Button variant="secondary" onClick={() => onNewPassword(person)}>
              {t("people.newPassword")}
            </Button>
          ) : null}
          <Button disabled={!changed} loading={saving} loadingLabel={t("contentForm.saving")} onClick={() => void save()}>
            {t("access.save")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
