"use client";

import { useState } from "react";

import { Field, type FieldProps } from "./Field";
import styles from "./Field.module.css";

interface PasswordFieldProps extends Omit<FieldProps, "type" | "trailing"> {
  /** Visible text of the toggle while the password is hidden, such as "Show". */
  showText: string;
  hideText: string;
  /** Full accessible names, such as "Show password". They must contain the visible text. */
  showLabel: string;
  hideLabel: string;
}

/**
 * A password field with a Show/Hide toggle. Passphrases are long and typed blind on a phone, so
 * people need to be able to check what they typed. The toggle is a real button (44 px, keyboard
 * and screen reader friendly) that reports its state.
 */
export function PasswordField({ showText, hideText, showLabel, hideLabel, ...field }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Field
      {...field}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      spellCheck={false}
      trailing={
        <button type="button" className={styles.toggle} aria-pressed={visible} aria-label={visible ? hideLabel : showLabel} onClick={() => setVisible((v) => !v)}>
          {visible ? hideText : showText}
        </button>
      }
    />
  );
}
