"use client";

import { LogOut } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Panel, ReadFailure, ReadHeader, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { PALETTES, SCHOOL_PALETTE, type PaletteColors } from "@/theme/palettes";
import { choosePalette, readPalette } from "@/theme/personal";
import { Button, Field, Notice, PasswordField } from "@/ui";

import { ownPasswordFailure, profileProblems } from "./model";
import styles from "./settings.module.css";

export type Profile = { fullName: string; email: string; phone: string | null; canEditProfile: boolean };
type Said = { tone: "ok" | "bad"; keys: MessageKey[] } | null;

const SaidNotice = ({ said }: { said: Said }) =>
  said ? (
    <Notice tone={said.tone}>
      {said.keys.map((key) => (
        <p key={key}>{t(key)}</p>
      ))}
    </Notice>
  ) : null;

/** Your name and phone: staff correct their own; a student sees theirs (the Co-ordinator corrects a student's, D-091). */
export function ProfileCard({ profile }: { profile: Profile }) {
  const { api } = useSession();
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<Said>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problems = profileProblems({ fullName, phone });
    if (problems.length > 0) {
      setSaid({ tone: "bad", keys: problems });
      return;
    }
    setSaving(true);
    setSaid(null);
    try {
      const { response } = await api.PATCH("/api/account/profile", { body: { fullName: fullName.trim(), phone: phone.trim() === "" ? null : phone.trim() } });
      if (!response.ok) {
        setSaid({ tone: "bad", keys: ["settings.failed"] });
        return;
      }
      // The name travels in the sign-in: a renewed one carries the new name, and the page then shows it everywhere.
      await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      setSaid({ tone: "ok", keys: ["settings.profile.saved"] });
      window.location.reload();
    } catch {
      setSaid({ tone: "bad", keys: ["settings.failed"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={t("settings.profile.title")} labelledBy="profile-title">
      {profile.canEditProfile ? (
        <form onSubmit={save} noValidate className={styles.form}>
          <SaidNotice said={said} />
          <Field label={t("settings.profile.name")} value={fullName} maxLength={120} autoComplete="name" onChange={(event) => setFullName(event.target.value)} />
          <Field label={t("settings.profile.phone")} type="tel" inputMode="tel" value={phone} maxLength={30} autoComplete="tel" onChange={(event) => setPhone(event.target.value)} />
          <p className={readStyles.rowMeta}>{t("settings.profile.email", { email: profile.email })}</p>
          <div>
            <Button type="submit" loading={saving} loadingLabel={t("settings.saving")}>
              {t("settings.profile.save")}
            </Button>
          </div>
        </form>
      ) : (
        <dl className={styles.facts}>
          <div>
            <dt className={readStyles.rowMeta}>{t("settings.profile.name")}</dt>
            <dd>{profile.fullName}</dd>
          </div>
          <div>
            <dt className={readStyles.rowMeta}>{t("settings.profile.emailLabel")}</dt>
            <dd>{profile.email}</dd>
          </div>
          <p className={readStyles.rowMeta}>{t("settings.profile.askCoordinator")}</p>
        </dl>
      )}
    </Panel>
  );
}

/** Change your own password: the current one, then a new one (with show and hide, as at sign-in). */
export function PasswordCard() {
  const { api } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<Said>(null);

  async function change(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!current || !next) {
      setSaid({ tone: "bad", keys: ["settings.password.bothNeeded"] });
      return;
    }
    setSaving(true);
    setSaid(null);
    try {
      const { response, error } = await api.POST("/api/auth/password/change", { body: { currentPassword: current, newPassword: next } });
      if (response.ok) {
        setSaid({ tone: "ok", keys: ["settings.password.changed"] });
        setCurrent("");
        setNext("");
      } else {
        setSaid({ tone: "bad", keys: ownPasswordFailure(response.status, error) });
      }
    } catch {
      setSaid({ tone: "bad", keys: ["settings.failed"] });
    } finally {
      setSaving(false);
    }
  }

  const toggles = { showText: t("signIn.show"), hideText: t("signIn.hide"), showLabel: t("signIn.showPassword"), hideLabel: t("signIn.hidePassword") };
  return (
    <Panel title={t("settings.password.title")} labelledBy="password-title">
      <form onSubmit={change} noValidate className={styles.form}>
        <SaidNotice said={said} />
        <PasswordField label={t("settings.password.current")} name="current-password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} {...toggles} />
        <PasswordField label={t("settings.password.new")} name="new-password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} {...toggles} />
        <p className={readStyles.rowMeta}>{t("settings.password.help")}</p>
        <div>
          <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("settings.saving")}>
            {t("settings.password.save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Appearance (D-127): the colours of your own portal, the school's or one of the calm palettes. Chosen with radio
 * buttons and shown at once; kept in this browser, so it writes nothing on the server.
 */
export function AppearanceCard() {
  const { config } = useConfig();
  const [chosen, setChosen] = useState(() => (typeof window === "undefined" ? SCHOOL_PALETTE : readPalette()));
  const school = (config?.theme as { light?: PaletteColors } | null | undefined)?.light;
  const options = [{ key: SCHOOL_PALETTE, name: "appearance.palette.school" as MessageKey, colors: school }, ...PALETTES];
  return (
    <Panel title={t("appearance.title")} labelledBy="appearance-title">
      <p className={readStyles.rowMeta}>{t("appearance.help")}</p>
      <fieldset className={styles.palettes}>
        <legend className="sr-only">{t("appearance.legend")}</legend>
        {options.map((o) => (
          <label key={o.key} className={styles.palette}>
            <input
              type="radio"
              name="palette"
              value={o.key}
              checked={chosen === o.key}
              className={styles.paletteInput}
              onChange={() => {
                choosePalette(o.key);
                setChosen(o.key);
              }}
            />
            {/* A small picture of the palette: its page, a card, its action colour and its accent. */}
            <span className={styles.preview} style={o.colors ? { background: o.colors.background, borderColor: o.colors.border } : undefined} aria-hidden>
              <span className={styles.previewCard} style={o.colors ? { background: o.colors.surface } : undefined}>
                <span className={styles.previewAction} style={o.colors ? { background: o.colors.primary } : undefined} />
                <span className={styles.previewAccent} style={o.colors ? { background: o.colors.accent } : undefined} />
              </span>
            </span>
            <span className={styles.paletteName}>{t(o.name)}</span>
          </label>
        ))}
      </fieldset>
    </Panel>
  );
}

/** Settings (D-091): your profile, your password, your colours (D-127), and signing out. */
export function SettingsScreen() {
  const { api, signOut } = useSession();
  const load = useCallback(async (): Promise<{ ok: true; data: Profile } | { ok: false; reason: "failed" }> => {
    try {
      const { data } = await api.GET("/api/account/profile");
      return data ? { ok: true, data } : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }, [api]);
  const { view, reload } = useLoad(load);

  return (
    <div className={`${readStyles.page} ${styles.narrow}`}>
      <ReadHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <ProfileCard profile={view.data} /> : null}
      <PasswordCard />
      <AppearanceCard />
      <Panel title={t("settings.signOut.title")} labelledBy="signout-title">
        <p className={readStyles.rowMeta}>{t("settings.signOut.help")}</p>
        <div>
          <Button variant="secondary" onClick={() => void signOut()} className={styles.withIcon}>
            <LogOut aria-hidden className={styles.icon} />
            {t("shell.signOut")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
