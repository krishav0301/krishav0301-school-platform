"use client";

import { useRef, useState, type FormEvent } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { Button, Card, Notice, PasswordField } from "@/ui";

import { changeFailureMessages } from "./password-change";
import { useSession } from "./SessionProvider";
import styles from "./new-password.module.css";

/**
 * The step after signing in with a temporary password (D-059): choose one only the person knows. There is no session
 * yet, only the challenge from sign-in, so nothing else in the portal opens until this is done. One password box with a
 * show and hide button, and no repeat box: with the password visible on request a typo is easy to see, and a forgotten
 * one can be replaced. A weak or reused choice leaves the step usable; an expired one sends the person back to the start.
 */
export function NewPasswordStep({
  challenge,
  onNext,
  onRestart,
}: {
  challenge: string;
  /** The person still has an authenticator step to do. */
  onNext: (step: "code" | "setup", challenge: string) => void;
  onRestart: () => void;
}) {
  const { changeRequiredPassword } = useSession();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<MessageKey[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // a second Enter press must not send a second request
    if (!password) {
      setProblems(["reset.weak.too_short"]);
      return;
    }
    setProblems([]);
    setSubmitting(true);
    const result = await changeRequiredPassword(challenge, password);
    if (result.ok) {
      // Signed in: the sign-in page takes the person to the portal. Or an authenticator step is still to do.
      if ("twoFactor" in result) onNext(result.twoFactor === "required" ? "code" : "setup", result.challenge);
      return;
    }
    const { keys, restart } = changeFailureMessages(result);
    if (restart) {
      onRestart();
      return;
    }
    setProblems(keys);
    setPassword("");
    input.current?.focus(); // where the next attempt starts
    setSubmitting(false);
  }

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("signIn.newTitle")}</h1>
        <p className={styles.help}>{t("signIn.newHelp")}</p>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {problems.length > 0 ? (
          <Notice tone="bad">
            {problems.map((key) => (
              <p key={key}>{t(key)}</p>
            ))}
          </Notice>
        ) : null}
        <PasswordField
          label={t("signIn.newPassword")}
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          ref={input}
          showText={t("signIn.show")}
          hideText={t("signIn.hide")}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
        />
        <Button type="submit" fullWidth className={styles.wrapLabel} loading={submitting} loadingLabel={t("signIn.newSubmitting")}>
          {submitting ? t("signIn.newSubmitting") : t("signIn.newSubmit")}
        </Button>
      </form>
    </Card>
  );
}
