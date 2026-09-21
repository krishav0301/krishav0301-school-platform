import { useId, type Ref, type TextareaHTMLAttributes } from "react";

import styles from "./Field.module.css";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  /** Shown under the field, and announced. Presence marks the field invalid. */
  error?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/** A labelled multi-line input. It looks and is wired like `Field`. */
export function TextArea({ label, hint, error, className, ref, rows = 6, ...input }: TextAreaProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <textarea
        {...input}
        ref={ref}
        id={id}
        rows={rows}
        className={[styles.input, styles.multiline].join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
      />
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
