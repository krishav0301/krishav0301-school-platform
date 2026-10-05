"use client";

import { useState } from "react";

import { BsDateField } from "@/content/BsDateField";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { Field, Select } from "@/ui";

import fieldStyles from "@/ui/Field.module.css";

import styles from "./admissions.module.css";
import { choiceForLevel, levelSteps, type LevelChoice } from "./level-steps";
import type { ApplicantErrors, ApplicantForm, OpenLevel } from "./model";

/**
 * The fields every applicant gives, whether through the public form, a Co-ordinator's walk-in, or an
 * Accountant's registration (D-063). "Referred by (if any)" is optional free text, matching the source
 * document exactly.
 */
export function ApplicantFields({
  values,
  errors,
  levels,
  onChange,
  fieldRefs,
}: {
  values: ApplicantForm;
  errors: ApplicantErrors;
  levels: readonly OpenLevel[];
  onChange: <K extends keyof ApplicantForm>(name: K, value: ApplicantForm[K]) => void;
  fieldRefs?: { firstName?: React.Ref<HTMLInputElement>; dobBs?: React.Ref<HTMLInputElement>; levelId?: React.Ref<HTMLSelectElement> };
}) {
  const err = (field: keyof ApplicantErrors) => (errors[field] ? t(errors[field]!) : undefined);

  return (
    <>
      <Field ref={fieldRefs?.firstName} label={t("admissions.field.firstName")} value={values.firstName} autoComplete="given-name" onChange={(e) => onChange("firstName", e.target.value)} error={err("firstName")} />
      <Field label={t("admissions.field.middleName")} value={values.middleName} autoComplete="additional-name" onChange={(e) => onChange("middleName", e.target.value)} />
      <Field label={t("admissions.field.lastName")} value={values.lastName} autoComplete="family-name" onChange={(e) => onChange("lastName", e.target.value)} error={err("lastName")} />
      <BsDateField ref={fieldRefs?.dobBs} legend={t("admissions.field.dob")} value={values.dobBs} onChange={(text) => onChange("dobBs", text)} error={err("dobBs")} />
      <Field label={t("admissions.field.phone")} value={values.phone} autoComplete="tel" inputMode="tel" onChange={(e) => onChange("phone", e.target.value)} error={err("phone")} />
      <Field label={t("admissions.field.email")} type="email" value={values.email} autoComplete="email" onChange={(e) => onChange("email", e.target.value)} error={err("email")} />
      <Field label={t("admissions.field.guardianName")} value={values.guardianName} onChange={(e) => onChange("guardianName", e.target.value)} error={err("guardianName")} />
      <Field label={t("admissions.field.guardianPhone")} value={values.guardianPhone} inputMode="tel" onChange={(e) => onChange("guardianPhone", e.target.value)} error={err("guardianPhone")} />
      <Field label={t("admissions.field.previousSchool")} hint={t("admissions.field.previousSchoolHint")} value={values.previousSchool} onChange={(e) => onChange("previousSchool", e.target.value)} />
      <Field label={t("admissions.field.referredBy")} hint={t("admissions.field.referredByHint")} value={values.referredBy} onChange={(e) => onChange("referredBy", e.target.value)} />
      <LevelFields levels={levels} levelId={values.levelId} onChange={(levelId) => onChange("levelId", levelId)} error={err("levelId")} levelRef={fieldRefs?.levelId} />
    </>
  );
}

/**
 * "Applying for" (D-114, FUT point 14): the wing, then the course, then the level, in the school's words. A step with
 * one choice is said, not offered (D-030). Only the level is the form's value; the wing and course are how it is found.
 * The error, and the focus after a failed send, go to the first step still to choose.
 */
function LevelFields({ levels, levelId, onChange, error, levelRef }: { levels: readonly OpenLevel[]; levelId: string; onChange: (levelId: string) => void; error?: string; levelRef?: React.Ref<HTMLSelectElement> }) {
  const { term } = useConfig();
  const [wanted, setWanted] = useState<LevelChoice>(() => choiceForLevel(levels, levelId));
  const steps = levelSteps(levels, levelId ? { ...wanted, ...choiceForLevel(levels, levelId) } : wanted);
  const { choice } = steps;
  const choose = { value: "", label: t("admissions.field.levelChoose") };
  const pick = (next: LevelChoice) => {
    const settled = levelSteps(levels, next).choice;
    setWanted(settled);
    onChange(settled.levelId ?? "");
  };
  const first = steps.wings.length > 1 && !choice.sectionKey ? "wing" : steps.courses.length > 1 && !choice.programmeId ? "course" : "level";
  const given = [steps.wings.length === 1 ? steps.wings[0]!.name : null, steps.courses.length === 1 ? steps.courses[0]!.name : null, steps.levels.length === 1 ? steps.levels[0]!.name : null].filter(Boolean);

  return (
    <fieldset className={styles.levelSteps}>
      <legend className={fieldStyles.label}>{t("admissions.field.level")}</legend>
      {given.length > 0 ? <p className={styles.levelGiven}>{given.join(" · ")}</p> : null}
      {steps.wings.length > 1 ? (
        <Select
          ref={first === "wing" ? levelRef : undefined}
          label={term("term.section")}
          value={choice.sectionKey ?? ""}
          onChange={(e) => pick({ sectionKey: e.target.value || null, programmeId: null, levelId: null })}
          options={[choose, ...steps.wings.map((w) => ({ value: w.key, label: w.name }))]}
          error={first === "wing" ? error : undefined}
        />
      ) : null}
      {steps.courses.length > 1 ? (
        <Select
          ref={first === "course" ? levelRef : undefined}
          label={term("term.programme")}
          value={choice.programmeId ?? ""}
          onChange={(e) => pick({ ...choice, programmeId: e.target.value || null, levelId: null })}
          options={[choose, ...steps.courses.map((c) => ({ value: c.id, label: c.name }))]}
          error={first === "course" ? error : undefined}
        />
      ) : null}
      {steps.levels.length > 1 ? (
        <Select
          ref={first === "level" ? levelRef : undefined}
          label={term("term.level")}
          value={choice.levelId ?? ""}
          onChange={(e) => pick({ ...choice, levelId: e.target.value || null })}
          options={[choose, ...steps.levels.map((l) => ({ value: l.id, label: l.name }))]}
          error={first === "level" ? error : undefined}
        />
      ) : null}
    </fieldset>
  );
}
