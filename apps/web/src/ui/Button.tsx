import type { ButtonHTMLAttributes } from "react";

import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

/** The class names of a button, for an element that is not a `<button>` (a link that looks like one). */
export function buttonClass({ variant = "primary", fullWidth = false }: { variant?: ButtonVariant; fullWidth?: boolean } = {}): string {
  return [styles.button, styles[variant], fullWidth ? styles.full : ""].filter(Boolean).join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Shows a spinner and blocks further clicks, so a slow request cannot be submitted twice. */
  loading?: boolean;
  /** Accessible name for the spinner while loading. */
  loadingLabel?: string;
}

export function Button({ variant = "primary", fullWidth, loading = false, loadingLabel, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={[buttonClass({ variant, fullWidth }), className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner label={loadingLabel} small /> : null}
      {children}
    </button>
  );
}
