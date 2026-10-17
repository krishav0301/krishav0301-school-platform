"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { QrCode } from "@/two-factor/qr";
import { Button, CopyButton, Field, Notice } from "@/ui";

import { createAccount, disableAccount, loadAccounts, newLogin, signOutComputer, type LoginMade } from "./accounts-client";
import type { AccountList, IssuedLogin } from "./client";
import styles from "./gate.module.css";

type Account = AccountList["accounts"][number];
type Computer = Account["computers"][number];

/** Where the gate screen lives: the same address on every computer. */
const gateAddress = () => (typeof window === "undefined" ? "/gate" : `${window.location.origin}/gate`);

/**
 * The gate logins (D-176), on the Admin's Settings page: make one (an ID, a password and an authenticator, shown once),
 * give one a new login, disable one, and sign a computer out. Shown only to an Admin or Support, and only where the school
 * uses cards; the server decides again on every change.
 */
export function GateAccountsCard() {
  const { moduleEnabled } = useConfig();
  const { me } = useSession();
  const allowed = me?.roles.some((r) => r.role === "admin" || r.role === "super_admin") ?? false;
  if (!allowed || !moduleEnabled("card_attendance")) return null;
  return <Accounts />;
}

function Accounts() {
  const { api } = useSession();
  const load = useCallback(() => loadAccounts(api), [api]);
  const { view, reload } = useLoad<AccountList>(load);
  const [login, setLogin] = useState<IssuedLogin | null>(null);

  const showLogin = (made: LoginMade) => {
    if (made.ok) {
      setLogin(made.login);
      void reload();
    }
  };

  return (
    <Panel title={t("gate.accounts.title")} labelledBy="gate-accounts-title">
      <p className={readStyles.rowMeta}>{t("gate.accounts.intro")}</p>
      {login ? <LoginNotice login={login} onDone={() => setLogin(null)} /> : <AddForm onMade={showLogin} />}
      {view.status === "loading" ? <TableSkeleton rows={2} /> : null}
      {view.status === "failed" ? <Notice tone="bad">{t("gate.accounts.loadFailed")}</Notice> : null}
      {view.status === "ready" && view.data.accounts.length === 0 ? <EmptyLine>{t("gate.accounts.empty")}</EmptyLine> : null}
      {view.status === "ready" && view.data.accounts.length > 0 ? (
        <ul className={styles.deviceList}>
          {view.data.accounts.map((account) => (
            <AccountRow key={account.id} account={account} onChanged={() => void reload()} onLogin={showLogin} />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** The login, once: the ID, the password and the authenticator's QR code and setup key. Held only in this screen's state: never in the address, storage or a log. */
function LoginNotice({ login, onDone }: { login: IssuedLogin; onDone: () => void }) {
  return (
    <section role="status" className={styles.keyNotice}>
      <h3 className={styles.keyTitle}>{t("gate.accounts.loginTitle", { name: login.name })}</h3>
      <p className={readStyles.rowMeta}>{t("gate.accounts.loginBody", { address: gateAddress() })}</p>
      <dl className={styles.secrets}>
        <div>
          <dt>{t("gate.accounts.id")}</dt>
          <dd className={styles.key}>{login.gateId}</dd>
        </div>
        <div>
          <dt>{t("gate.accounts.password")}</dt>
          <dd className={styles.key}>{login.password}</dd>
        </div>
        <div>
          <dt>{t("gate.accounts.setupKey")}</dt>
          <dd className={styles.key}>{login.authenticator.secret}</dd>
        </div>
      </dl>
      <p className={readStyles.rowMeta}>{t("gate.accounts.qrBody")}</p>
      <QrCode text={login.authenticator.uri} label={t("gate.accounts.qrLabel")} className={styles.qr} />
      <div className={styles.row}>
        <CopyButton text={`${login.gateId}\n${login.password}`} label={t("gate.accounts.copy")} copiedLabel={t("gate.accounts.copied")} />
        <Button onClick={onDone}>{t("gate.accounts.done")}</Button>
      </div>
    </section>
  );
}

function AddForm({ onMade }: { onMade: (made: LoginMade) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || name.trim().length < 2) return;
    setProblem(null);
    setSaving(true);
    const result = await createAccount(api, name.trim());
    setSaving(false);
    if (result.ok) {
      setName("");
      return onMade(result);
    }
    setProblem(result.reason === "invalid" ? result.message : t("gate.accounts.failed"));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.addForm}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("gate.accounts.name")} hint={t("gate.accounts.nameHint")} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="off" />
      <div>
        <Button type="submit" variant="secondary" loading={saving} loadingLabel={t("gate.accounts.adding")} disabled={name.trim().length < 2}>
          {t("gate.accounts.add")}
        </Button>
      </div>
    </form>
  );
}

type Asking = "login" | "disable" | null;

function AccountRow({ account, onChanged, onLogin }: { account: Account; onChanged: () => void; onLogin: (made: LoginMade) => void }) {
  const { api } = useSession();
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    if (asking === "login") {
      const made = await newLogin(api, account.id);
      setBusy(false);
      if (!made.ok) return setFailed(true);
      setAsking(null);
      return onLogin(made);
    }
    const ok = await disableAccount(api, account.id);
    setBusy(false);
    if (!ok) return setFailed(true);
    setAsking(null);
    onChanged();
  }

  const active = account.status === "active";
  return (
    <li className={styles.device}>
      <div className={styles.deviceHead}>
        <span className={styles.deviceName}>{account.name}</span>
        <StatusWord tone={active ? "ok" : "neutral"}>{t(active ? "gate.accounts.active" : "gate.accounts.disabled")}</StatusWord>
      </div>
      <p className={readStyles.rowMeta}>{account.gateId}</p>
      {active ? (
        <>
          <p className={readStyles.rowMeta}>{t("gate.accounts.computers")}</p>
          {account.computers.filter((c) => c.status === "active").length === 0 ? <EmptyLine>{t("gate.accounts.noComputers")}</EmptyLine> : null}
          <ul className={styles.deviceList}>
            {account.computers
              .filter((c) => c.status === "active")
              .map((computer) => (
                <ComputerRow key={computer.id} computer={computer} onChanged={onChanged} />
              ))}
          </ul>
        </>
      ) : null}
      {failed ? <Notice tone="bad">{t("gate.accounts.failed")}</Notice> : null}
      {active && asking ? (
        <div className={styles.confirm}>
          <p className={readStyles.rowMeta}>{t(asking === "login" ? "gate.accounts.newLoginSure" : "gate.accounts.disableSure", { name: account.name })}</p>
          <div className={styles.row}>
            <Button variant="secondary" loading={busy} loadingLabel={t("cards.saving")} onClick={() => void confirm()}>
              {t(asking === "login" ? "gate.accounts.newLoginYes" : "gate.accounts.disableYes")}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setAsking(null)}>
              {t("gate.accounts.keep")}
            </Button>
          </div>
        </div>
      ) : null}
      {active && !asking ? (
        <div className={styles.row}>
          <Button variant="quiet" onClick={() => setAsking("login")}>
            {t("gate.accounts.newLogin")}
          </Button>
          <Button variant="quiet" onClick={() => setAsking("disable")}>
            {t("gate.accounts.disable")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ComputerRow({ computer, onChanged }: { computer: Computer; onChanged: () => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setBusy(true);
    setFailed(false);
    const ok = await signOutComputer(api, computer.id);
    setBusy(false);
    if (ok) return onChanged();
    setFailed(true);
  }
  const used = computer.lastSeenOnBs && computer.lastSeenTime ? t("gate.accounts.lastUsed", { date: formatBsDate(computer.lastSeenOnBs), time: computer.lastSeenTime }) : t("gate.accounts.neverUsed");
  return (
    <li className={styles.device}>
      <div className={styles.deviceHead}>
        <span className={styles.deviceName}>{computer.label}</span>
        <Button variant="quiet" loading={busy} loadingLabel={t("cards.saving")} onClick={() => void signOut()}>
          {t("gate.accounts.signOut")}
        </Button>
      </div>
      <p className={readStyles.rowMeta}>{used}</p>
      {failed ? <Notice tone="bad">{t("gate.accounts.failed")}</Notice> : null}
    </li>
  );
}
