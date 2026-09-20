"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession, type SignInResult } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { Button, Card, Field, Notice, PasswordField } from "@/ui";

import styles from "./sign-in.module.css";

const FAILURE_MESSAGE: Record<Extract<SignInResult, { ok: false }>["reason"], MessageKey> = {
  invalid: "signIn.invalid",
  throttled: "signIn.throttled",
  network: "signIn.network",
  unexpected: "signIn.unexpected",
};

function SignInForm() {
  const { config } = useConfig();
  const { status, signIn, endedUnexpectedly } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (status === "signedIn") router.replace("/portal");
  }, [status, router]);

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
        {endedUnexpectedly && !problem ? <Notice>{t("signIn.sessionEnded")}</Notice> : null}
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
      </form>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <PublicShell showSignIn={false}>
      <div className={styles.center}>
        <ConfigGate>
          <SignInForm />
        </ConfigGate>
      </div>
    </PublicShell>
  );
}
