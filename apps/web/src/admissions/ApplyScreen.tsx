"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { toAd } from "@/content/client";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Card, Checkbox, Notice, Skeleton } from "@/ui";

import { ApplicantFields } from "./ApplicantFields";
import admissionsStyles from "./admissions.module.css";
import { apply, loadOpenLevels, newSubmissionToken, verifyEmail } from "./client";
import { emptyApplicantForm, firstInvalid, validateApplicant, type ApplicantErrors, type ApplicantForm, type OpenLevel } from "./model";
import setupStyles from "@/setup/setup.module.css";

type Levels = { status: "loading" } | { status: "ready"; levels: OpenLevel[] } | { status: "failed" };

/**
 * The public application form (D-063). One submission token is made once, when the form first loads,
 * and reused on every retry. The title and intro show at once; only the fields wait on the level list
 * (D-030: show the shape of a page while it loads, not a lone spinner).
 */
export function ApplyScreen() {
  const { api } = useSession();
  const [levels, setLevels] = useState<Levels>({ status: "loading" });
  const [values, setValues] = useState<ApplicantForm>(emptyApplicantForm());
  const [errors, setErrors] = useState<ApplicantErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const token = useRef(newSubmissionToken());
  const firstNameRef = useRef<HTMLInputElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const levelRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let active = true;
    void loadOpenLevels(api).then((result) => {
      if (active) setLevels(result.ok ? { status: "ready", levels: result.data } : { status: "failed" });
    });
    return () => {
      active = false;
    };
  }, [api]);

  const set = useCallback(<K extends keyof ApplicantForm>(name: K, value: ApplicantForm[K]) => setValues((current) => ({ ...current, [name]: value })), []);

  async function submit() {
    if (pending) return;
    setFailure(null);
    const problems = validateApplicant(values);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      const first = firstInvalid(problems);
      if (first === "firstName") firstNameRef.current?.focus();
      else if (first === "dobBs") dobRef.current?.focus();
      else if (first === "levelId") levelRef.current?.focus();
      return;
    }
    if (!consent) return setFailure(t("admissions.error.consentRequired"));
    setPending(true);
    const converted = await toAd(api, values.dobBs);
    if (!converted.ok) {
      setPending(false);
      setErrors({ dobBs: converted.error === "dateUnverified" ? "admissions.error.dobUnverified" : "admissions.error.dobInvalid" });
      return;
    }
    const result = await apply(api, values, converted.ad, token.current, website);
    setPending(false);
    if (result.ok) return setDone(true);
    if (result.reason === "throttled") setFailure(t("admissions.error.throttled"));
    else if (result.reason === "invalid") setFailure(result.message);
    else setFailure(t("admissions.error.failed"));
  }

  if (done) {
    return (
      <Card>
        <h1 className={setupStyles.title}>{t("admissions.apply.doneTitle")}</h1>
        <p>{t("admissions.apply.doneBody", { email: values.email })}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className={setupStyles.title}>{t("admissions.apply.title")}</h1>
      <p className={setupStyles.muted}>{t("admissions.apply.intro")}</p>
      {levels.status === "loading" ? (
        <div role="status" aria-busy="true" className={setupStyles.list}>
          <span className="sr-only">{t("setup.loading")}</span>
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </div>
      ) : levels.status === "failed" ? (
        <Notice tone="bad">{t("admissions.error.failed")}</Notice>
      ) : (
        <>
          {failure ? <Notice tone="bad">{failure}</Notice> : null}
          <form
            className={admissionsStyles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <ApplicantFields values={values} errors={errors} levels={levels.levels} onChange={set} fieldRefs={{ firstName: firstNameRef, dobBs: dobRef, levelId: levelRef }} />
            <div className={admissionsStyles.honeypot} aria-hidden="true">
              <label htmlFor="admissions-website">Website</label>
              <input id="admissions-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <p>
              <Link href="/privacy">{t("admissions.apply.privacyLink")}</Link>
            </p>
            <Checkbox label={t("admissions.apply.privacyConsent")} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <Button type="submit" loading={pending} loadingLabel={t("admissions.apply.submitting")}>
              {t("admissions.apply.submit")}
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}

/** The link in the confirmation email leads here: `/apply#token=...`. */
export function VerifyScreen({ token }: { token: string }) {
  const { api } = useSession();
  const [state, setState] = useState<"checking" | "done" | "failed">("checking");

  useEffect(() => {
    let active = true;
    void verifyEmail(api, token).then((result) => {
      if (active) setState(result.ok ? "done" : "failed");
    });
    return () => {
      active = false;
    };
  }, [api, token]);

  if (state === "checking") {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("setup.loading")}</span>
        <Skeleton width="60%" height="1.75rem" />
      </div>
    );
  }
  if (state === "failed") return <Notice tone="bad">{t("admissions.verify.failed")}</Notice>;
  return (
    <Card>
      <h1 className={setupStyles.title}>{t("admissions.verify.doneTitle")}</h1>
      <p>{t("admissions.verify.doneBody")}</p>
    </Card>
  );
}
