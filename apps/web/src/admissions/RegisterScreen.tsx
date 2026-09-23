"use client";

import { useEffect, useRef, useState } from "react";

import { toAd } from "@/content/client";
import { t } from "@/i18n/messages";
import { TemporaryPasswordNotice } from "@/people/StaffScreen";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Button, Notice, Skeleton } from "@/ui";

import { ApplicantFields } from "./ApplicantFields";
import admissionsStyles from "./admissions.module.css";
import { ClassPicker } from "./ClassPicker";
import { loadOpenLevels, registerForQueue, registerWalkIn } from "./client";
import { emptyApplicantForm, firstInvalid, validateApplicant, type ApplicantErrors, type ApplicantForm, type OpenLevel } from "./model";

type Levels = { status: "loading" } | { status: "ready"; levels: OpenLevel[] } | { status: "failed" };

/**
 * The Co-ordinator's walk-in (auto-approved, needs a class) and the Accountant's registration (goes to
 * the queue, no class yet — the Co-ordinator places them at approval time). Same fields; `canPlace`
 * decides which.
 */
export function RegisterScreen({ canPlace }: { canPlace: boolean }) {
  const { api } = useSession();
  const [levels, setLevels] = useState<Levels>({ status: "loading" });
  const [values, setValues] = useState<ApplicantForm>(emptyApplicantForm());
  const [errors, setErrors] = useState<ApplicantErrors>({});
  const [classId, setClassId] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
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

  const set = <K extends keyof ApplicantForm>(name: K, value: ApplicantForm[K]) => setValues((current) => ({ ...current, [name]: value }));

  async function submit() {
    if (pending) return;
    setFailure(null);
    const problems = validateApplicant(values);
    if (canPlace && !classId) problems.levelId = problems.levelId ?? "admissions.error.classRequired";
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      const first = firstInvalid(problems);
      if (first === "firstName") firstNameRef.current?.focus();
      else if (first === "dobBs") dobRef.current?.focus();
      else if (first === "levelId") levelRef.current?.focus();
      return;
    }
    setPending(true);
    const converted = await toAd(api, values.dobBs);
    if (!converted.ok) {
      setPending(false);
      setErrors({ dobBs: converted.error === "dateUnverified" ? "admissions.error.dobUnverified" : "admissions.error.dobInvalid" });
      return;
    }
    if (canPlace) {
      const result = await registerWalkIn(api, values, converted.ad, classId);
      setPending(false);
      if (result.ok) return setSecret({ name: `${values.firstName} ${values.lastName}`, password: result.temporaryPassword });
      if (result.reason === "invalid") setFailure(result.message);
      else if (result.reason === "forbidden") setFailure(t("content.forbidden"));
      else setFailure(t("admissions.error.failed"));
      return;
    }
    const result = await registerForQueue(api, values, converted.ad);
    setPending(false);
    if (result.ok) return setDone({ id: result.id });
    if (result.reason === "invalid") setFailure(result.message);
    else if (result.reason === "forbidden") setFailure(t("content.forbidden"));
    else setFailure(t("admissions.error.failed"));
  }

  if (secret) {
    return (
      <TemporaryPasswordNotice
        name={secret.name}
        password={secret.password}
        onDone={() => {
          setSecret(null);
          setValues(emptyApplicantForm());
          setClassId("");
        }}
      />
    );
  }

  if (done) {
    return <Notice tone="ok">{t("admissions.register.doneQueue")}</Notice>;
  }

  return (
    <div>
      <h1 className={setupStyles.title}>{t(canPlace ? "admissions.register.walkInTitle" : "admissions.register.queueTitle")}</h1>
      <p className={setupStyles.muted}>{t(canPlace ? "admissions.register.walkInIntro" : "admissions.register.queueIntro")}</p>
      {levels.status === "loading" ? (
        <div role="status" aria-busy="true" className={setupStyles.list}>
          <span className="sr-only">{t("setup.loading")}</span>
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
            {canPlace && values.levelId ? <ClassPicker levelId={values.levelId} value={classId} onChange={setClassId} /> : null}
            <Button type="submit" loading={pending} loadingLabel={t("admissions.apply.submitting")}>
              {t(canPlace ? "admissions.register.submitWalkIn" : "admissions.register.submitQueue")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

