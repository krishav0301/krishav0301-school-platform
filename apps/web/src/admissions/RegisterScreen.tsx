"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { toAd } from "@/content/client";
import { t } from "@/i18n/messages";
import { TemporaryPasswordNotice } from "@/people/StaffScreen";
import { Panel, ReadHeader, TableSkeleton, readStyles } from "@/read/ReadView";
import { Facts } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { Button, Notice } from "@/ui";

import { ApplicantFields } from "./ApplicantFields";
import admissionsStyles from "./admissions.module.css";
import { ClassPicker } from "./ClassPicker";
import { loadOpenLevels, registerForQueue, registerWalkIn } from "./client";
import { emptyApplicantForm, firstInvalid, validateApplicant, type ApplicantErrors, type ApplicantForm, type OpenLevel } from "./model";

type Levels = { status: "loading" } | { status: "ready"; levels: OpenLevel[] } | { status: "failed" };
type RoleClaim = { role: string; scope: string; section?: string };

/**
 * The levels a person may place a walk-in into: all of them, unless every Co-ordinator role they hold is for one
 * section, then only that section's (Co-ordinator FUT F-11: the server already refused the rest; the form now agrees).
 */
export function levelsFor(levels: readonly OpenLevel[], roles: readonly RoleClaim[]): OpenLevel[] {
  if (roles.some((r) => r.role === "super_admin" || ((r.role === "coordinator" || r.role === "accountant") && r.scope === "institution"))) return [...levels];
  const sections = new Set(roles.filter((r) => r.scope === "section" && r.section).map((r) => r.section!));
  return sections.size === 0 ? [...levels] : levels.filter((l) => sections.has(l.sectionKey));
}

/**
 * The Co-ordinator's walk-in (auto-approved, needs a class) and the Accountant's registration (goes to the queue, no
 * class yet; the Co-ordinator places them at approval). Same fields; `canPlace` decides which. Redesigned in D-106: a
 * calm header, the form in one card, errors that clear as each field is fixed (F-01), a possible duplicate named before
 * anyone is admitted twice (F-03), and the new student ID shown with the temporary password (F-04).
 */
export function RegisterScreen({ canPlace }: { canPlace: boolean }) {
  const { api, me } = useSession();
  const [levels, setLevels] = useState<Levels>({ status: "loading" });
  const [values, setValues] = useState<ApplicantForm>(emptyApplicantForm());
  const [errors, setErrors] = useState<ApplicantErrors>({});
  const [classId, setClassId] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [admitted, setAdmitted] = useState<{ name: string; sid: string; password: string } | null>(null);
  const [duplicates, setDuplicates] = useState<{ name: string; sid: string }[] | null>(null);
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

  // A field's message goes as soon as that field changes (F-01), and so does a duplicate warning about the old details.
  const set = <K extends keyof ApplicantForm>(name: K, value: ApplicantForm[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name as keyof ApplicantErrors] ? { ...current, [name]: undefined } : current));
    setDuplicates(null);
    if (name === "levelId") setClassId("");
  };

  async function submit(confirmDuplicate = false) {
    if (pending) return;
    setFailure(null);
    const problems = validateApplicant(values);
    if (canPlace && values.levelId && !classId) problems.levelId = problems.levelId ?? "admissions.error.classRequired";
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
      const result = await registerWalkIn(api, values, converted.ad, classId, confirmDuplicate);
      setPending(false);
      if (result.ok) return setAdmitted({ name: `${values.firstName} ${values.lastName}`, sid: result.sid, password: result.temporaryPassword });
      if (result.reason === "duplicate") return setDuplicates(result.matches);
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

  const again = () => {
    setAdmitted(null);
    setDone(null);
    setValues(emptyApplicantForm());
    setClassId("");
    setErrors({});
  };

  if (admitted) {
    return (
      <div className={readStyles.page}>
        <ReadHeader title={t("admissions.register.admittedTitle")} subtitle={t("admissions.register.admittedIntro", { name: admitted.name })} />
        <Panel>
          <Facts
            rows={[
              { name: t("admissions.field.name"), value: admitted.name },
              { name: t("admissions.record.sid"), value: <strong className={admissionsStyles.sid}>{admitted.sid}</strong> },
            ]}
          />
          <TemporaryPasswordNotice name={admitted.name} password={admitted.password} onDone={again} />
        </Panel>
      </div>
    );
  }

  if (done) {
    return (
      <div className={readStyles.page}>
        <ReadHeader title={t("admissions.register.queueTitle")} />
        <Notice tone="ok">{t("admissions.register.doneQueue")}</Notice>
        <div>
          <Button variant="secondary" onClick={again}>
            {t("admissions.register.another")}
          </Button>
        </div>
      </div>
    );
  }

  const choices = levels.status === "ready" ? levelsFor(levels.levels, me?.roles ?? []) : [];

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t(canPlace ? "admissions.register.walkInTitle" : "admissions.register.queueTitle")} subtitle={t(canPlace ? "admissions.register.walkInIntro" : "admissions.register.queueIntro")} />
      {levels.status === "loading" ? <TableSkeleton rows={6} /> : null}
      {levels.status === "failed" ? <Notice tone="bad">{t("admissions.error.failed")}</Notice> : null}
      {levels.status === "ready" ? (
        <Panel>
          {failure ? <Notice tone="bad">{failure}</Notice> : null}
          <form
            className={admissionsStyles.formGrid}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <ApplicantFields values={values} errors={errors} levels={choices} onChange={set} fieldRefs={{ firstName: firstNameRef, dobBs: dobRef, levelId: levelRef }} />
            {canPlace && values.levelId ? (
              <ClassPicker
                levelId={values.levelId}
                value={classId}
                onChange={(id) => {
                  setClassId(id);
                  setErrors((current) => ({ ...current, levelId: undefined }));
                  setDuplicates(null);
                }}
              />
            ) : null}
            {duplicates ? (
              <div className={admissionsStyles.wide}>
                <Notice tone="bad">
                  <span className={admissionsStyles.duplicate}>
                    <span>{t("admissions.register.duplicateIntro")}</span>
                    <span className={admissionsStyles.duplicateList}>
                      {duplicates.map((d) => (
                        <span key={d.sid}>
                          {d.name} ({d.sid})
                        </span>
                      ))}
                    </span>
                    <span>{t("admissions.register.duplicateAsk")}</span>
                  </span>
                </Notice>
              </div>
            ) : null}
            <div className={admissionsStyles.formActions}>
              {duplicates ? (
                <Button type="button" loading={pending} loadingLabel={t("admissions.apply.submitting")} onClick={() => void submit(true)}>
                  {t("admissions.register.admitAnyway")}
                </Button>
              ) : (
                <Button type="submit" loading={pending} loadingLabel={t("admissions.apply.submitting")}>
                  {t(canPlace ? "admissions.register.submitWalkIn" : "admissions.register.submitQueue")}
                </Button>
              )}
              {duplicates ? (
                <Link href="/portal/admissions/search" className={admissionsStyles.quietLink}>
                  {t("admissions.register.findExisting")}
                </Link>
              ) : null}
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
