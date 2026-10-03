"use client";

import { KeyRound, UserCheck, UserX, UsersRound } from "lucide-react";
import { useCallback, useId, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, Segments, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { manageableSections, type RoleView } from "@/setup/model";
import setupStyles from "@/setup/setup.module.css";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, CopyButton, Field, Notice, Select } from "@/ui";

import { createStaff, createTeacher, issueTemporaryPassword, loadStaff, setStaffActive } from "./client";
import { REASON_MESSAGE, addableRoles, canManageMember, validateStaffForm, type AddableRole, type StaffFormErrors, type StaffMember } from "./model";
import styles from "./people.module.css";

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

/** Where a person works, in words: their home section, their role's section, or the whole school. */
export const placeOf = (member: StaffMember, sections: readonly Section[]): string => {
  const first = member.roles[0];
  return member.homeSection !== null ? sectionName(sections, member.homeSection) : first?.scope === "section" ? sectionName(sections, first.section) : t("people.wholeSchool");
};

/** The person's account in words: switched off, never signed in, or active. */
export function accountState(member: StaffMember): { tone: "ok" | "bad" | "warn"; key: MessageKey } {
  if (!member.active) return { tone: "bad", key: "people.off" };
  if (member.mustChangePassword) return { tone: "warn", key: "people.neverSignedIn" };
  return { tone: "ok", key: "people.active" };
}

/** Four figures (D-106): everyone listed, active, not signed in yet, switched off. */
export function staffFigures(staff: readonly StaffMember[]): Figure[] {
  return [
    { key: "all", icon: UsersRound, tone: "accent", value: String(staff.length), label: t("people.figure.all") },
    { key: "active", icon: UserCheck, tone: "ok", value: String(staff.filter((m) => m.active).length), label: t("people.figure.active") },
    { key: "new", icon: KeyRound, tone: "warn", value: String(staff.filter((m) => m.active && m.mustChangePassword).length), label: t("people.figure.new") },
    { key: "off", icon: UserX, tone: "bad", value: String(staff.filter((m) => !m.active).length), label: t("people.figure.off") },
  ];
}

export type StaffFilter = "all" | "active" | "off";

/** The people a search and a filter leave: name or email, any case. Pure. */
export function filterStaff(staff: readonly StaffMember[], query: string, filter: StaffFilter): StaffMember[] {
  const q = query.trim().toLowerCase();
  return staff.filter((m) => (filter === "all" || (filter === "active") === m.active) && (!q || m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)));
}

/** One person: name, role and place, their email, the account in words, and Manage when they may be managed. Pure. */
export function StaffCard({ member, sections, canManage, onManage }: { member: StaffMember; sections: readonly Section[]; canManage: boolean; onManage: () => void }) {
  const { term } = useConfig();
  const state = accountState(member);
  return (
    <li className={readStyles.rowItem}>
      <div className={readStyles.rowHead}>
        <h3 className={readStyles.rowTitle}>{member.fullName}</h3>
        <StatusWord tone={state.tone}>{t(state.key)}</StatusWord>
      </div>
      <p className={readStyles.rowMeta}>{[...member.roles.map((r) => roleTerm(term, r.role)), placeOf(member, sections)].join(" · ")}</p>
      <p className={readStyles.rowMeta}>{member.email}</p>
      {canManage ? (
        <div>
          <Button variant="secondary" onClick={onManage} aria-label={t("people.manageItem", { name: member.fullName })}>
            {t("people.manage")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** The list, or the one line that says why it is empty. */
export function StaffView({ staff, roles, sections, onManage }: { staff: readonly StaffMember[]; roles: readonly RoleView[]; sections: readonly Section[]; onManage: (member: StaffMember) => void }) {
  if (staff.length === 0) return <EmptyLine>{t("people.empty")}</EmptyLine>;
  return (
    <ul className={readStyles.rows}>
      {staff.map((member) => (
        <StaffCard key={member.id} member={member} sections={sections} canManage={canManageMember(roles, member)} onManage={() => onManage(member)} />
      ))}
    </ul>
  );
}

/** One person, opened from their card: the facts, then switch off or on, or a new temporary password. */
function ManagePanel({ member, sections, onClose }: { member: StaffMember; sections: readonly Section[]; onClose: (changed: boolean) => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const [busy, setBusy] = useState<"toggle" | "password" | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [active, setActive] = useState(member.active);
  const [changed, setChanged] = useState(false);
  const state = accountState({ ...member, active });

  async function toggle() {
    setBusy("toggle");
    setOutcome(null);
    const result = await setStaffActive(api, member.id, !active);
    setBusy(null);
    if (!result.ok) return setOutcome({ tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    setOutcome({ tone: "ok", text: t(active ? "people.done.switchedOff" : "people.done.switchedOn", { name: member.fullName }) });
    setActive(!active);
    setChanged(true);
  }

  async function issue() {
    setBusy("password");
    setOutcome(null);
    const result = await issueTemporaryPassword(api, member.id);
    setBusy(null);
    if (!result.ok) return setOutcome({ tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    setSecret(result.temporaryPassword);
    setChanged(true);
  }

  return (
    <SidePanel
      title={member.fullName}
      subtitle={[...member.roles.map((r) => roleTerm(term, r.role)), placeOf(member, sections)].join(" · ")}
      status={<StatusWord tone={state.tone}>{t(state.key)}</StatusWord>}
      busy={busy !== null}
      onClose={() => onClose(changed)}
      foot={
        secret ? null : (
          <div className={styles.manageFoot}>
            {active ? (
              <Button variant="secondary" loading={busy === "password"} loadingLabel={t("setup.working")} disabled={busy !== null} onClick={() => void issue()}>
                {t("people.newPassword")}
              </Button>
            ) : null}
            <Button variant={active ? "quiet" : "primary"} loading={busy === "toggle"} loadingLabel={t("setup.working")} disabled={busy !== null} onClick={() => void toggle()}>
              {t(active ? "people.switchOff" : "people.switchOn")}
            </Button>
          </div>
        )
      }
    >
      {outcome ? <Notice tone={outcome.tone}>{outcome.text}</Notice> : null}
      {secret ? <TemporaryPasswordNotice name={member.fullName} password={secret} onDone={() => setSecret(null)} /> : null}
      <PanelSection title={t("people.details")}>
        <Facts
          rows={[
            { name: t("people.email"), value: member.email },
            { name: t("people.phoneShort"), value: member.phone ?? "—" },
            { name: t("people.place"), value: placeOf(member, sections) },
            { name: t("people.account"), value: t(state.key) },
          ]}
        />
      </PanelSection>
      {active ? <p className={readStyles.rowMeta}>{t("people.manageHint")}</p> : null}
    </SidePanel>
  );
}

// --- The form ----------------------------------------------------------------------------------------

/** Adds a person. Someone who can add only one kind of person is not asked which; they are told which. */
export function StaffForm({
  roles,
  sections,
  onCreated,
  initialRole,
  showTitle = true,
}: {
  roles: readonly RoleView[];
  sections: readonly Section[];
  onCreated: (name: string, password: string) => void;
  /** The role to start on, when the person may add it (a dashboard quick action, D-089). */
  initialRole?: AddableRole | null;
  /** Off inside the Add pop-up, which carries the title itself. */
  showTitle?: boolean;
}) {
  const { api } = useSession();
  const { term } = useConfig();
  const options = addableRoles(roles);
  const [role, setRole] = useState<AddableRole>(initialRole && options.includes(initialRole) ? initialRole : (options[0] ?? "teacher"));
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
      {showTitle ? <h2 className={setupStyles.formTitle}>{t("people.add")}</h2> : null}
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
      <Field label={t("people.fullName")} value={fullName} maxLength={120} autoComplete="off" onChange={(event) => {
          setFullName(event.target.value);
          setErrors((e) => ({ ...e, fullName: undefined }));
        }} error={say(errors.fullName)} />
      <Field
        label={t("people.email")}
        type="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setErrors((e) => ({ ...e, email: undefined }));
        }}
        error={say(errors.email)}
      />
      <Field label={t("people.phone")} type="tel" inputMode="tel" autoComplete="off" value={phone} maxLength={30} onChange={(event) => {
          setPhone(event.target.value);
          setErrors((e) => ({ ...e, phone: undefined }));
        }} error={say(errors.phone)} />
      <Select
        label={isTeacher ? t("people.homeSection") : t("people.section")}
        value={sectionKey}
        onChange={(event) => {
          setSectionKey(event.target.value);
          setErrors((e) => ({ ...e, sectionKey: undefined }));
        }}
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

/**
 * Staff, as the Co-ordinator sees it (the Principal has People & Access, D-099). Redesigned in D-106 after the admin's
 * pages: figures, a search, one card per person, and a side panel to switch them off or on or give a new password.
 */
export function StaffScreen() {
  const { api, me } = useSession();
  const { config } = useConfig();
  const roles = me?.roles ?? [];
  const sections = config?.sections ?? [];
  const options = addableRoles(roles);
  // `?add=coordinator` (a dashboard quick action, D-089) opens the Add pop-up on that role, if this person may add it.
  const search = useAddressQuery();
  const asked = search === null ? null : new URLSearchParams(search).get("add");
  const wanted = asked !== null && (options as string[]).includes(asked) ? (asked as AddableRole) : null;
  const load = useCallback(() => loadStaff(api), [api]);
  const { view, reload } = useLoad(load);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const [open, setOpen] = useState<StaffMember | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StaffFilter>("all");

  const add =
    options.length > 0 ? (
      <AddDialog label={t("people.add")} title={t("people.add")} openNow={wanted !== null}>
        {(close) => (
          <StaffForm
            key={wanted ?? "any"}
            roles={roles}
            sections={sections}
            initialRole={wanted}
            showTitle={false}
            onCreated={(name, password) => {
              close();
              setSecret({ name, password });
              void reload();
            }}
          />
        )}
      </AddDialog>
    ) : undefined;
  const staff = view.status === "ready" ? view.data.staff : [];
  const shown = filterStaff(staff, query, filter);

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("people.title")} subtitle={t("people.intro")} actions={add} />
      {secret ? <TemporaryPasswordNotice name={secret.name} password={secret.password} onDone={() => setSecret(null)} /> : null}
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          {staff.length > 0 ? <FigureTiles figures={staffFigures(staff)} label={t("people.figures")} /> : null}
          <Panel>
            {staff.length > 0 ? (
              <div className={styles.listTools}>
                <div className={readStyles.search}>
                  <Field label={t("people.search")} type="search" value={query} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
                </div>
                <Segments
                  label={t("people.filter")}
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { key: "all", label: t("people.filter.all") },
                    { key: "active", label: t("people.filter.active") },
                    { key: "off", label: t("people.filter.off") },
                  ]}
                />
              </div>
            ) : null}
            {staff.length > 0 && shown.length === 0 ? <EmptyLine>{t("people.noMatch")}</EmptyLine> : <StaffView staff={shown} roles={roles} sections={sections} onManage={setOpen} />}
          </Panel>
        </>
      ) : null}
      {open ? (
        <ManagePanel
          member={open}
          sections={sections}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void reload();
          }}
        />
      ) : null}
    </div>
  );
}
