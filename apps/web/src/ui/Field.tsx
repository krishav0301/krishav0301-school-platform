import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

import styles from "./Field.module.css";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  /** Shown under the field, and announced. Presence marks the field invalid. */
  error?: string;
  /** A control inside the field's trailing edge, such as a show/hide button. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled text input. The label, hint and error are wired to the input for screen readers. */
export function Field({ label, hint, error, trailing, className, ref, ...input }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <input
          {...input}
          ref={ref}
          id={id}
          className={[styles.input, trailing ? styles.withTrailing : ""].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        />
        {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      </div>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
