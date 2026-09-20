"use client";

import { useEffect, useState } from "react";

import { Button, type ButtonVariant } from "./Button";

/**
 * Copies some text to the clipboard. The label changes to "Copied" for two seconds, and the change is
 * announced to screen readers (the button's own text change is not reliably read out).
 */
export function CopyButton({ text, label, copiedLabel, variant = "secondary" }: { text: string; label: string; copiedLabel: string; variant?: ButtonVariant }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked: the text is still on screen to select by hand */
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => void copy()}>
        {copied ? copiedLabel : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
