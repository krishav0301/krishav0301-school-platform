"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { createApiClient } from "@/api/client";
import { t, type MessageKey } from "@/i18n/messages";
import { Button, Card, Field, Notice, PasswordField, buttonClass } from "@/ui";

import styles from "./reset.module.css";

type Problem = "too_short" | "too_long" | "common" | "contains_email" | "contains_school_name";

const PROBLEM_MESSAGE: Record<Problem, MessageKey> = {
  too_short: "reset.weak.too_short",
  too_long: "reset.weak.too_long",
  common: "reset.weak.common",
  contains_email: "reset.weak.contains_email",
  contains_school_name: "reset.weak.contains_school_name",
};

/** Step 1: ask for a link. The answer is always "check your email", whether or not the address has an account. */
export function RequestForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!email.trim()) {
      setProblem("reset.required");
      return;
    }
    setProblem(null);
    setSubmitting(true);
    try {
      const { response } = await createApiClient().POST("/api/auth/password-reset/request", { body: { email: email.trim() } });
      if (response.status === 202) setSentTo(email.trim());
      else setProblem("reset.network");
    } catch {
      setProblem("reset.network");
    }
    setSubmitting(false);
  }

  if (sentTo) {
    return (
      <Card className={styles.card}>
        <h1 className={styles.title}>{t("reset.sentTitle")}</h1>
        <p className={styles.body}>{t("reset.sentBody", { email: sentTo })}</p>
        <Link href="/sign-in" className={buttonClass({ variant: "secondary" })}>
          {t("reset.backToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("reset.title")}</h1>
        <p className={styles.body}>{t("reset.help")}</p>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
        <Field
          label={t("reset.email")}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("reset.submitting")}>
          {submitting ? t("reset.submitting") : t("reset.submit")}
        </Button>
        <Link href="/sign-in" className={buttonClass({ variant: "quiet", fullWidth: true })}>
          {t("reset.backToSignIn")}
        </Link>
      </form>
    </Card>
  );
}

/** Step 2: choose a new password, with the token from the emailed link. */
export function NewPasswordForm({ token, onLinkInvalid }: { token: string; onLinkInvalid: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setProblems([]);
    setFailure(null);
    setSubmitting(true);
    try {
      const { response, error } = await createApiClient().POST("/api/auth/password-reset/confirm", { body: { token, password } });
      if (response.status === 204) {
        window.history.replaceState(null, "", window.location.pathname); // the link is spent: take it out of the address bar
        setDone(true);
      } else if (response.status === 422 && error && "problems" in error) {
        setProblems(error.problems);
        input.current?.focus(); // a weak password leaves the link usable: try again right here
      } else if (response.status === 400) {
        setFailure("reset.linkInvalid");
      } else {
        setFailure("reset.network");
      }
    } catch {
      setFailure("reset.network");
    }
    setSubmitting(false);
  }

  if (done) {
    return (
      <Card className={styles.card}>
        <h1 className={styles.title}>{t("reset.doneTitle")}</h1>
        <p className={styles.body}>{t("reset.doneBody")}</p>
        <Link href="/sign-in" className={buttonClass()}>
          {t("reset.goToSignIn")}
        </Link>
      </Card>
    );
  }

  if (failure === "reset.linkInvalid") {
    return (
      <Card className={styles.card}>
        <h1 className={styles.title}>{t("reset.title")}</h1>
        <Notice tone="bad">{t("reset.linkInvalid")}</Notice>
        <Button onClick={onLinkInvalid}>{t("reset.getNewLink")}</Button>
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("reset.newTitle")}</h1>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {failure ? <Notice tone="bad">{t(failure)}</Notice> : null}
        <PasswordField
          label={t("reset.newPassword")}
          name="password"
          autoComplete="new-password"
          hint={t("reset.newHelp")}
          error={problems.length > 0 ? problems.map((problem) => t(PROBLEM_MESSAGE[problem])).join(" ") : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          ref={input}
          showText={t("signIn.show")}
          hideText={t("signIn.hide")}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
        />
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("reset.newSubmitting")}>
          {submitting ? t("reset.newSubmitting") : t("reset.newSubmit")}
        </Button>
      </form>
    </Card>
  );
}
