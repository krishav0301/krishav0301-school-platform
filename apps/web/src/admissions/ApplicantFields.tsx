import { BsDateField } from "@/content/BsDateField";
import { t } from "@/i18n/messages";
import { Field, Select } from "@/ui";

import type { ApplicantErrors, ApplicantForm, OpenLevel } from "./model";
import { levelChoices } from "./model";

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
      <Select
        ref={fieldRefs?.levelId}
        label={t("admissions.field.level")}
        value={values.levelId}
        onChange={(e) => onChange("levelId", e.target.value)}
        options={[{ value: "", label: t("admissions.field.levelChoose") }, ...levelChoices(levels)]}
        error={err("levelId")}
      />
    </>
  );
}
