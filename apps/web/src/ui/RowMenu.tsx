"use client";

import { EllipsisVertical } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import styles from "./RowMenu.module.css";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
}

/**
 * A row's "more" menu (D-098, D-099: the references' three dots). A button that opens a short list of actions: the
 * arrow keys move between them, Enter chooses, Escape or a click elsewhere closes it, and focus goes back to
 * the button. Nothing is shown when there is nothing to choose (a menu of one entry is not shown either, D-030:
 * the caller puts a lone action on the row itself).
 */
export function RowMenu({ label, actions, disabled = false }: { label: string; actions: MenuAction[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (actions.length < 2) return null;

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLUListElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  return (
    <div className={styles.menuWrap}>
      <button
        ref={button}
        type="button"
        className={styles.menuButton}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <EllipsisVertical aria-hidden />
      </button>
      {open ? (
        <ul ref={menu} id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onKey}>
          {actions.map((action) => (
            <li key={action.key} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  close();
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
