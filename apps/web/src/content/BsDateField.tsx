import { useId, useState, type Ref } from "react";

import { t } from "@/i18n/messages";
import fieldStyles from "@/ui/Field.module.css";

import { MONTH_LABEL, joinBs, splitBs, type BsParts } from "./model";
import styles from "./content.module.css";

/**
 * A Nepali (Bikram Sambat) day, filled in as day, month and year. The month is chosen by name, so nobody
 * has to remember that Ashwin is month 6, and the day and year use the number keypad on a phone, which
 * has no hyphen to type. The value that goes in and out is still the text "YYYY-MM-DD" (empty when
 * nothing is filled in), so the rest of the form does not change. Whether the day exists is checked by
 * the server, which is the only place that knows the calendar.
 */
export function BsDateField({
  legend,
  hint,
  error,
  value,
  onChange,
  ref,
}: {
  legend: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (text: string) => void;
  /** Goes to the first box (the day), so the cursor can move there when the day has a problem. */
  ref?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = error ? true : undefined;

  // The pieces are held here as typed, so "1" on the way to "10" is not turned into "01" under the cursor.
  const [parts, setParts] = useState<BsParts>(() => splitBs(value));
  function change(next: Partial<BsParts>) {
    const merged = { ...parts, ...next };
    setParts(merged);
    onChange(joinBs(merged));
  }

  return (
    <fieldset className={styles.dateField}>
      <legend className={fieldStyles.label}>{legend}</legend>
      <div className={styles.dateParts}>
        <div className={fieldStyles.field}>
          <label htmlFor={`${id}-day`} className={styles.partLabel}>
            {t("contentForm.day")}
          </label>
          <input
            ref={ref}
            id={`${id}-day`}
            className={fieldStyles.input}
            inputMode="numeric"
            maxLength={2}
            autoComplete="off"
            value={parts.day}
            onChange={(event) => change({ day: event.target.value })}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        </div>
        <div className={fieldStyles.field}>
          <label htmlFor={`${id}-month`} className={styles.partLabel}>
            {t("contentForm.month")}
          </label>
          <select
            id={`${id}-month`}
            className={`${fieldStyles.input} ${fieldStyles.select}`}
            value={parts.month}
            onChange={(event) => change({ month: event.target.value })}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          >
            <option value="">{t("contentForm.choose")}</option>
            {MONTH_LABEL.map((key, index) => (
              <option key={key} value={String(index + 1)}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldStyles.field}>
          <label htmlFor={`${id}-year`} className={styles.partLabel}>
            {t("contentForm.year")}
          </label>
          <input
            id={`${id}-year`}
            className={fieldStyles.input}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={parts.year}
            onChange={(event) => change({ year: event.target.value })}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        </div>
      </div>
      {hint ? (
        <p id={hintId} className={fieldStyles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={fieldStyles.error}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
