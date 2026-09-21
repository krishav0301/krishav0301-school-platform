import { useId, type InputHTMLAttributes } from "react";

import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  label: string;
  hint?: string;
}

/** One yes-or-no choice. The whole row is the target, and the hint is read out with the label. */
export function Checkbox({ label, hint, className, ...input }: CheckboxProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={[styles.row, className].filter(Boolean).join(" ")}>
      <input {...input} id={id} type="checkbox" className={styles.box} aria-describedby={hintId} />
      <label htmlFor={id} className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
