"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { NewPasswordStep } from "@/session/NewPasswordStep";
import { useSession, type Me, type SignInResult } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { CodeStep, RecoveryCodesStep, SetupStep } from "@/two-factor/steps";
import { Button, Card, Field, Notice, PasswordField, buttonClass } from "@/ui";

import styles from "./sign-in.module.css";

const FAILURE_MESSAGE: Record<Extract<SignInResult, { ok: false }>["reason"], MessageKey> = {
  invalid: "signIn.invalid",
  throttled: "signIn.throttled",
  network: "signIn.network",
  unexpected: "signIn.unexpected",
};

/** Where the person is in signing in. The second step and the recovery codes appear only when needed. */
type Step =
  | { kind: "credentials"; notice?: MessageKey }
  | { kind: "password"; challenge: string }
  | { kind: "code"; challenge: string }
  | { kind: "setup"; challenge: string }
  | { kind: "recovery"; codes: string[]; me: Me };

function CredentialsStep({ notice, onSecondStep }: { notice?: MessageKey; onSecondStep: (step: "code" | "setup" | "password", challenge: string) => void }) {
  const { config } = useConfig();
  const { signIn, endedUnexpectedly } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // a second Enter press must not send a second request
    if (!email.trim() || !password) {
      setProblem("signIn.required");
      return;
    }
    setProblem(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    if (result.ok && "passwordChange" in result) {
      onSecondStep("password", result.challenge); // a temporary password: choose your own first
      return;
    }
    if (result.ok && "twoFactor" in result) {
      onSecondStep(result.twoFactor === "required" ? "code" : "setup", result.challenge);
      return;
    }
    if (!result.ok) {
      setProblem(FAILURE_MESSAGE[result.reason]);
      setPassword("");
      // Put the cursor where the next attempt starts, so a keyboard or screen-reader user can just retype.
      passwordInput.current?.focus();
    }
    setSubmitting(false);
  }

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("signIn.title", { school: config?.school.name ?? "" })}</h1>
        <p className={styles.help}>{t("signIn.help")}</p>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {notice && !problem ? <Notice>{t(notice)}</Notice> : null}
        {endedUnexpectedly && !problem && !notice ? <Notice>{t("signIn.sessionEnded")}</Notice> : null}
        {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
        <Field
          label={t("signIn.email")}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <PasswordField
          label={t("signIn.password")}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          ref={passwordInput}
          showText={t("signIn.show")}
          hideText={t("signIn.hide")}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
        />
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("signIn.submitting")}>
          {submitting ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
        <Link href="/reset-password" className={buttonClass({ variant: "quiet", fullWidth: true })}>
          {t("signIn.forgot")}
        </Link>
      </form>
    </Card>
  );
}

function SignInFlow() {
  const { config } = useConfig();
  const { status, acceptSession } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "credentials" });

  // Signed in (by a finished sign-in or a completed second step): nothing left to do here.
  useEffect(() => {
    if (status === "signedIn") router.replace("/portal");
  }, [status, router]);

  // Stable, because the setup step re-runs its effect when this changes.
  const restart = useCallback(() => setStep({ kind: "credentials", notice: "twoFactor.expired" }), []);
  const backToStart = useCallback(() => setStep({ kind: "credentials" }), []);

  switch (step.kind) {
    case "password":
      return <NewPasswordStep challenge={step.challenge} onNext={(kind, challenge) => setStep({ kind, challenge })} onRestart={restart} />;
    case "code":
      return <CodeStep challenge={step.challenge} schoolName={config?.school.name ?? ""} onRestart={restart} onDifferentAccount={backToStart} />;
    case "setup":
      return <SetupStep challenge={step.challenge} onRestart={restart} onEnabled={(codes, me) => setStep({ kind: "recovery", codes, me })} />;
    case "recovery":
      return <RecoveryCodesStep codes={step.codes} onDone={() => acceptSession(step.me)} />;
    default:
      return <CredentialsStep notice={step.notice} onSecondStep={(kind, challenge) => setStep({ kind, challenge })} />;
  }
}

export default function SignInPage() {
  return (
    <PublicShell showSignIn={false}>
      <div className={styles.center}>
        <ConfigGate>
          <SignInFlow />
        </ConfigGate>
      </div>
    </PublicShell>
  );
}
