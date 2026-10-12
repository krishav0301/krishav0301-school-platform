"use client";

import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession, type Me, type SignInResult } from "@/session/SessionProvider";
import { Button, Checkbox, Notice } from "@/ui";

import styles from "./sign-in.module.css";

// The two pictures are loaded after the form, so the form is not waiting for them (and the page stays light).
// The steps after the password (a new password, the authenticator code, its set-up) are loaded only when they are needed.
const NewPasswordStep = dynamic(() => import("@/session/NewPasswordStep").then((m) => m.NewPasswordStep), { ssr: false });
const CodeStep = dynamic(() => import("@/two-factor/steps").then((m) => m.CodeStep), { ssr: false });
const SetupStep = dynamic(() => import("@/two-factor/steps").then((m) => m.SetupStep), { ssr: false });
const RecoveryCodesStep = dynamic(() => import("@/two-factor/steps").then((m) => m.RecoveryCodesStep), { ssr: false });
const BookCapArt = dynamic(() => import("./SignInArt").then((m) => m.BookCapArt), { ssr: false });

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

/** The email kept on this device for "Remember me". Only the email, never the password; a browser with storage off just forgets. */
const REMEMBER_KEY = "school.sign-in-email";
const rememberedEmail = (): string => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
};
const remember = (email: string | null): void => {
  try {
    if (email === null) window.localStorage.removeItem(REMEMBER_KEY);
    else window.localStorage.setItem(REMEMBER_KEY, email);
  } catch {
    // storage is off: nothing to keep
  }
};

/** One field of the card: its label, an icon at the start, and (for the password) a button at the end. */
function IconField({
  label,
  icon,
  invalid,
  describedBy,
  trailing,
  ref,
  ...input
}: {
  label: string;
  icon: React.ReactNode;
  invalid: boolean;
  describedBy?: string;
  trailing?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control} data-invalid={invalid}>
        {icon}
        <input {...input} ref={ref} id={id} className={styles.input} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
        {trailing}
      </div>
    </div>
  );
}

/** Who to ask for a new password, from the person with the least reach up: nothing here opens another screen (D-166). */
export function ForgotHelp({ id }: { id: string }) {
  const { term } = useConfig();
  return (
    <div id={id} className={styles.note} role="status">
      <p>{t("signIn.forgotLead")}</p>
      <ul>
        <li>{t("signIn.forgotStudent", { coordinator: term("role.coordinator") })}</li>
        <li>{t("signIn.forgotCoordinator", { coordinator: term("role.coordinator"), admin: term("role.admin") })}</li>
        <li>{t("signIn.forgotAdmin", { admin: term("role.admin") })}</li>
      </ul>
    </div>
  );
}

function CredentialsStep({ notice, onSecondStep }: { notice?: MessageKey; onSecondStep: (step: "code" | "setup" | "password", challenge: string) => void }) {
  const { signIn, endedUnexpectedly } = useSession();
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [keepEmail, setKeepEmail] = useState(() => rememberedEmail() !== "");
  const [visible, setVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const problemId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // a second Enter press must not send a second request
    if (!email.trim() || !password) {
      setProblem("signIn.required");
      return;
    }
    setProblem(null);
    setSubmitting(true);
    remember(keepEmail ? email.trim() : null);
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
    <section className={styles.card} aria-labelledby="sign-in-title">
      <BookCapArt />
      <div className={styles.heading}>
        <h1 id="sign-in-title" className={styles.title}>
          {t("signIn.heading")}
        </h1>
        <p className={styles.help}>{t("signIn.welcome")}</p>
      </div>
      <form onSubmit={submit} className={styles.form} noValidate>
        {notice && !problem ? <Notice>{t(notice)}</Notice> : null}
        {endedUnexpectedly && !problem && !notice ? <Notice>{t("signIn.sessionEnded")}</Notice> : null}
        {problem ? (
          <div id={problemId}>
            <Notice tone="bad">{t(problem)}</Notice>
          </div>
        ) : null}
        <IconField
          label={t("signIn.email")}
          icon={<Mail aria-hidden className={styles.icon} />}
          invalid={problem !== null}
          describedBy={problem ? problemId : undefined}
          type="email"
          name="email"
          placeholder={t("signIn.emailPlaceholder")}
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <IconField
          label={t("signIn.password")}
          icon={<Lock aria-hidden className={styles.icon} />}
          invalid={problem !== null}
          describedBy={problem ? problemId : undefined}
          type={visible ? "text" : "password"}
          name="password"
          placeholder={t("signIn.passwordPlaceholder")}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          ref={passwordInput}
          trailing={
            <button type="button" className={styles.eye} aria-pressed={visible} aria-label={visible ? t("signIn.hidePassword") : t("signIn.showPassword")} onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          }
        />
        <div className={styles.options}>
          <Checkbox label={t("signIn.remember")} checked={keepEmail} onChange={(event) => setKeepEmail(event.target.checked)} />
          <button type="button" className={styles.forgot} aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen((open) => !open)}>
            {t("signIn.forgotShort")}
          </button>
        </div>
        {helpOpen ? <ForgotHelp id={helpId} /> : null}
        <Button type="submit" fullWidth loading={submitting} loadingLabel={t("signIn.submitting")}>
          {t("signIn.submit")}
          <ArrowRight aria-hidden className={styles.submitIcon} />
        </Button>
      </form>
    </section>
  );
}

export function SignInFlow() {
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

  const form = (() => {
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
  })();

  return (
    <div className={styles.layout}>
      <div className={styles.brand}>
        <p className={styles.brandName}>
          <Link href="/" className={styles.brandLink}>
            {config?.school.name}
          </Link>
        </p>
        <p className={styles.brandLine}>{t("signIn.brandLine")}</p>
        {/* Drawn for the school: two students in uniform. Decorative, so no text; the size is given so nothing moves when it loads, and it is not fetched on a phone, where it is hidden. */}
        {/* The pictures are static files from the site itself, already sized (D-126), so the image component adds nothing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sign-in/students.webp" width={800} height={614} alt="" className={styles.art} loading="lazy" decoding="async" />
      </div>
      <div className={styles.formSide}>{form}</div>
    </div>
  );
}
