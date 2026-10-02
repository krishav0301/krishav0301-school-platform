"use client";

import { Bold, Italic, Link, List, ListOrdered, Underline, type LucideIcon } from "lucide-react";
import { useId, useRef, useState, type Ref } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import fieldStyles from "@/ui/Field.module.css";

import { insertLink, lineStyleAt, setLineStyle, toggleMark, type Edit, type InlineMark, type LineStyle } from "./text-edit";
import styles from "./website.module.css";

const MARK_BUTTONS: { mark: InlineMark; icon: LucideIcon; label: MessageKey; key: string }[] = [
  { mark: "bold", icon: Bold, label: "contentForm.bold", key: "b" },
  { mark: "italic", icon: Italic, label: "contentForm.italic", key: "i" },
  { mark: "underline", icon: Underline, label: "contentForm.underline", key: "u" },
];
const LIST_BUTTONS: { style: LineStyle; icon: LucideIcon; label: MessageKey }[] = [
  { style: "bullets", icon: List, label: "contentForm.bullets" },
  { style: "numbers", icon: ListOrdered, label: "contentForm.numbers" },
];

/**
 * The content box with a light formatting bar (D-098): paragraph or heading, bold, italic, underline, two kinds of
 * list, and a link. The buttons write the few marks the website reads (`text-format.ts`), so what is stored is
 * plain text that cannot carry a script; the preview beside the form shows the result as it is typed.
 * Ctrl or Cmd with B, I or U works too.
 */
export function TextEditor({
  ref,
  label,
  hint,
  placeholder,
  value,
  error,
  onChange,
}: {
  ref?: Ref<HTMLTextAreaElement>;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [lineStyle, setLineStyleShown] = useState<LineStyle>("paragraph");

  const setRefs = (node: HTMLTextAreaElement | null) => {
    box.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  /** Applies one edit to the text and puts the selection where it says, after React has drawn the new text. */
  function apply(change: (edit: Edit) => Edit) {
    const node = box.current;
    if (!node) return;
    const next = change({ text: value, start: node.selectionStart, end: node.selectionEnd });
    onChange(next.text);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(next.start, next.end);
      setLineStyleShown(lineStyleAt(next.text, next.start));
    });
  }

  const track = () => {
    const node = box.current;
    if (node) setLineStyleShown(lineStyleAt(node.value, node.selectionStart));
  };

  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ");

  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={fieldStyles.label}>
        {label}
        <span className={styles.requiredMark} aria-hidden>
          *
        </span>
      </label>
      <div className={styles.editor} data-invalid={error ? true : undefined}>
        <div className={styles.toolbar} role="toolbar" aria-label={t("contentForm.toolbar")} aria-controls={id}>
          <select
            className={styles.styleSelect}
            aria-label={t("contentForm.blockStyle")}
            value={lineStyle === "heading" ? "heading" : "paragraph"}
            onChange={(event) => apply((edit) => setLineStyle(edit, event.target.value as LineStyle))}
          >
            <option value="paragraph">{t("contentForm.paragraph")}</option>
            <option value="heading">{t("contentForm.heading")}</option>
          </select>
          <span className={styles.toolbarRule} aria-hidden />
          {MARK_BUTTONS.map(({ mark, icon: Icon, label: name }) => (
            <button key={mark} type="button" className={styles.toolButton} aria-label={t(name)} title={t(name)} onClick={() => apply((edit) => toggleMark(edit, mark))}>
              <Icon aria-hidden />
            </button>
          ))}
          <span className={styles.toolbarRule} aria-hidden />
          {LIST_BUTTONS.map(({ style, icon: Icon, label: name }) => (
            <button
              key={style}
              type="button"
              className={styles.toolButton}
              aria-label={t(name)}
              title={t(name)}
              aria-pressed={lineStyle === style}
              onClick={() => apply((edit) => setLineStyle(edit, style))}
            >
              <Icon aria-hidden />
            </button>
          ))}
          <span className={styles.toolbarRule} aria-hidden />
          <button type="button" className={styles.toolButton} aria-label={t("contentForm.link")} title={t("contentForm.link")} onClick={() => apply((edit) => insertLink(edit, t("contentForm.link")))}>
            <Link aria-hidden />
          </button>
        </div>
        <textarea
          ref={setRefs}
          id={id}
          className={styles.editorBox}
          rows={9}
          value={value}
          placeholder={placeholder}
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          onSelect={track}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            const found = MARK_BUTTONS.find((b) => b.key === event.key.toLowerCase());
            if (!found) return;
            event.preventDefault();
            apply((edit) => toggleMark(edit, found.mark));
          }}
        />
      </div>
      <p id={`${id}-hint`} className={fieldStyles.hint}>
        {hint}
      </p>
      {error ? (
        <p id={`${id}-error`} className={fieldStyles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
