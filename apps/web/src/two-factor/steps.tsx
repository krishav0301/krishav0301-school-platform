"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { useSession, type Me, type TwoFactorFailure } from "@/session/SessionProvider";
import { Button, Card, CopyButton, Field, Notice, Spinner, buttonClass } from "@/ui";

import { QrCode } from "./qr";
import styles from "./steps.module.css";

const FAILURE_MESSAGE: Record<TwoFactorFailure, MessageKey> = {
  invalid_code: "twoFactor.invalidCode",
  invalid_challenge: "twoFactor.expired",
  throttled: "twoFactor.throttled",
  network: "signIn.network",
  unexpected: "signIn.unexpected",
};

/** The setup key in groups of four, which is how authenticator apps show and accept it. */
export const groupKey = (secret: string): string => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

// --- second step, for someone who already has the app ---------------------------------------

export function CodeStep({ challenge, schoolName, onRestart, onDifferentAccount }: { challenge: string; schoolName: string; onRestart: () => void; onDifferentAccount: () => void }) {
  const { verifyTwoFactor } = useSession();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!code.trim()) {
      setProblem("twoFactor.required");
      return;
    }
    setProblem(null);
    setSubmitting(true);
    const result = await verifyTwoFactor(challenge, code);
    if (!result.ok) {
      if (result.reason === "invalid_challenge") {
        onRestart(); // the challenge ran out: back to the password, which says why
        return;
      }
      setProblem(FAILURE_MESSAGE[result.reason]);
      setCode("");
      input.current?.focus();
    }
    setSubmitting(false);
  }

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("twoFactor.codeTitle")}</h1>
        <p className={styles.body}>{recovery ? t("twoFactor.recoveryHelp") : t("twoFactor.codeHelp", { school: schoolName })}</p>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
        <Field
          key={recovery ? "recovery" : "app"}
          label={recovery ? t("twoFactor.recoveryCode") : t("twoFactor.code")}
          name="code"
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          ref={input}
        />
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("twoFactor.verifying")}>
          {submitting ? t("twoFactor.verifying") : t("twoFactor.verify")}
        </Button>
        <Button
          variant="quiet"
          fullWidth
          onClick={() => {
            setRecovery((on) => !on);
            setCode("");
            setProblem(null);
          }}
        >
          {recovery ? t("twoFactor.useApp") : t("twoFactor.useRecovery")}
        </Button>
        <Button variant="quiet" fullWidth onClick={onDifferentAccount}>
          {t("twoFactor.differentAccount")}
        </Button>
      </form>
    </Card>
  );
}

// --- setting the app up ------------------------------------------------------------------------

/** What is shown once the key is ready. Separate from the step so it can be rendered without a network. */
export function SetupView({
  secret,
  otpauthUri,
  code,
  onCode,
  onSubmit,
  submitting,
  problem,
  codeInput,
}: {
  secret: string;
  otpauthUri: string;
  code: string;
  onCode: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  problem: MessageKey | null;
  codeInput?: Ref<HTMLInputElement>;
}) {
  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("twoFactor.setupTitle")}</h1>
        <p className={styles.body}>{t("twoFactor.setupIntro")}</p>
      </div>
      <div className={styles.qrBox}>
        <QrCode text={otpauthUri} label={t("twoFactor.qrLabel")} className={styles.qr} />
        <p className={styles.body}>{t("twoFactor.scanHelp")}</p>
      </div>
      <div className={styles.keyBox}>
        <p className={styles.keyHelp}>{t("twoFactor.orType")}</p>
        <span className={styles.keyLabel}>{t("twoFactor.setupKeyLabel")}</span>
        <code className={styles.key}>{groupKey(secret)}</code>
        <div className={styles.actions}>
          <CopyButton text={secret} label={t("twoFactor.copyKey")} copiedLabel={t("twoFactor.copied")} />
          <a href={otpauthUri} className={buttonClass({ variant: "quiet" })}>
            {t("twoFactor.openApp")}
          </a>
        </div>
      </div>
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <p className={styles.body}>{t("twoFactor.setupCodeHelp")}</p>
        {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
        <Field
          label={t("twoFactor.code")}
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(event) => onCode(event.target.value)}
          ref={codeInput}
        />
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("twoFactor.turningOn")}>
          {submitting ? t("twoFactor.turningOn") : t("twoFactor.turnOn")}
        </Button>
      </form>
    </Card>
  );
}

type Setup = { state: "loading" } | { state: "failed" } | { state: "ready"; secret: string; otpauthUri: string };

export function SetupStep({ challenge, onRestart, onEnabled }: { challenge: string; onRestart: () => void; onEnabled: (recoveryCodes: string[], me: Me) => void }) {
  const { startTwoFactorSetup, enableTwoFactor } = useSession();
  const [setup, setSetup] = useState<Setup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Asking for a key REPLACES the previous one on the server, so it must happen exactly once per
  // attempt: React runs effects twice in development, and two requests could leave the server
  // holding a different key from the one on screen.
  const mounted = useRef(true);
  const requestedFor = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const key = `${challenge}:${attempt}`;
    if (requestedFor.current === key) return;
    requestedFor.current = key;
    (async () => {
      const result = await startTwoFactorSetup(challenge);
      if (!mounted.current) return;
      if (result.ok) setSetup({ state: "ready", secret: result.secret, otpauthUri: result.otpauthUri });
      else if (result.reason === "invalid_challenge") onRestart();
      else setSetup({ state: "failed" });
    })();
  }, [challenge, attempt, startTwoFactorSetup, onRestart]); // onRestart must be a stable callback (the page memoises it)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!code.trim()) {
      setProblem("twoFactor.required");
      return;
    }
    setProblem(null);
    setSubmitting(true);
    const result = await enableTwoFactor(challenge, code);
    if (result.ok) {
      onEnabled(result.recoveryCodes, result.me);
      return;
    }
    if (result.reason === "invalid_challenge") {
      onRestart();
      return;
    }
    setProblem(result.reason === "no_setup" ? "twoFactor.setupFailed" : FAILURE_MESSAGE[result.reason]);
    setCode("");
    input.current?.focus();
    setSubmitting(false);
  }

  if (setup.state === "loading") {
    return (
      <Card className={styles.card} aria-busy="true">
        <Spinner label={t("twoFactor.setupLoading")} />
      </Card>
    );
  }
  if (setup.state === "failed") {
    return (
      <Card className={styles.card}>
        <Notice tone="bad">{t("twoFactor.setupFailed")}</Notice>
        <Button
          variant="secondary"
          onClick={() => {
            setSetup({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          {t("config.retry")}
        </Button>
      </Card>
    );
  }

  return <SetupView secret={setup.secret} otpauthUri={setup.otpauthUri} code={code} onCode={setCode} onSubmit={submit} submitting={submitting} problem={problem} codeInput={input} />;
}

// --- recovery codes ----------------------------------------------------------------------------

export function RecoveryCodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("twoFactor.recoveryTitle")}</h1>
        <p className={styles.body}>{t("twoFactor.recoveryIntro")}</p>
      </div>
      <ul className={styles.codes}>
        {codes.map((code) => (
          <li key={code}>
            <code className={styles.recoveryCode}>{code}</code>
          </li>
        ))}
      </ul>
      <CopyButton text={codes.join("\n")} label={t("twoFactor.copyCodes")} copiedLabel={t("twoFactor.copied")} />
      <Button onClick={onDone}>{t("twoFactor.savedThem")}</Button>
    </Card>
  );
}
