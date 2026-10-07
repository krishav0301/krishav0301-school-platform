"use client";

import { CalendarRange, ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";

import styles from "./shell.module.css";

/**
 * The term picker (D-127, the PM): one remembered choice of term, "All open terms" or one of them, shown in the top bar
 * on the pages that show several terms at once (Classes, Teaching) and used as the starting term by the pages that show
 * one (Setup › Classes, Exams, Teaching; Students). Only for those who may read the terms (`setup.structure.view`: the
 * Co-ordinator, the Principal and Support); it changes what a page shows, never what anyone may see.
 */
export const TERM_KEY = "school.term.v1";

export interface TermOption {
  id: string;
  label: string;
}

/** How many pages on screen use the picker: it is shown only while one does. */
function usersStore() {
  let count = 0;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((l) => l());
  return {
    add() {
      count += 1;
      tell();
      return () => {
        count -= 1;
        tell();
      };
    },
    get: () => count,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

interface TermChoiceValue {
  enabled: boolean;
  terms: readonly TermOption[];
  /** The chosen open term, or null for all open terms (also when the remembered one has closed). */
  choice: string | null;
  setChoice: (id: string | null) => void;
  users: ReturnType<typeof usersStore>;
}

const TermChoiceContext = createContext<TermChoiceValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(TERM_KEY);
  } catch {
    return null;
  }
}

/** The roles that may read the terms (`setup.structure.view`); everyone else has no picker. */
export const TERM_ROLES = ["coordinator", "admin", "super_admin"] as const;

export function TermChoiceProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { api } = useSession();
  const [terms, setTerms] = useState<readonly TermOption[]>([]);
  const [stored, setStored] = useState<string | null>(() => (typeof window === "undefined" ? null : readStored()));
  const [users] = useState(usersStore);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .GET("/api/academics/years")
      .then(({ data }) => {
        if (live && data) setTerms(data.years.filter((y) => y.status !== "closed").map((y) => ({ id: y.id, label: y.label })));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, enabled]);

  const value = useMemo<TermChoiceValue>(() => {
    const choice = stored && terms.some((x) => x.id === stored) ? stored : null;
    const setChoice = (id: string | null) => {
      setStored(id);
      try {
        if (id) localStorage.setItem(TERM_KEY, id);
        else localStorage.removeItem(TERM_KEY);
      } catch {
        /* storage blocked: the choice still holds for this visit */
      }
    };
    return { enabled, terms, choice, setChoice, users };
  }, [enabled, terms, stored, users]);

  return <TermChoiceContext.Provider value={value}>{children}</TermChoiceContext.Provider>;
}

const NONE: TermChoiceValue = { enabled: false, terms: [], choice: null, setChoice: () => {}, users: usersStore() };

/** For a page that shows several terms: the chosen term (null: all open ones). Shows the picker while the page is on screen. */
export function useTermChoice(): { choice: string | null } {
  const value = useContext(TermChoiceContext) ?? NONE;
  const { users } = value;
  useEffect(() => users.add(), [users]);
  return { choice: value.choice };
}

/** For a page that shows one term at a time: the remembered term to start on, and a way to remember a new one. */
export function useRememberedTerm(): { remembered: string | null; remember: (id: string) => void } {
  const value = useContext(TermChoiceContext) ?? NONE;
  return {
    remembered: value.choice,
    remember: (id) => {
      if (value.terms.some((x) => x.id === id)) value.setChoice(id);
    },
  };
}

/** The picker in the top bar: a native select (it works with every keyboard, screen reader and phone), styled as a pill. */
export function TermPicker() {
  const value = useContext(TermChoiceContext) ?? NONE;
  const inUse = useSyncExternalStore(value.users.subscribe, value.users.get, () => 0);
  // A menu of one entry is not shown (D-030): with a single open term, "all open terms" is that term.
  if (!value.enabled || inUse === 0 || value.terms.length < 2) return null;
  return <TermSelect terms={value.terms} choice={value.choice} onChoose={value.setChoice} />;
}

export function TermSelect({ terms, choice, onChoose }: { terms: readonly TermOption[]; choice: string | null; onChoose: (id: string | null) => void }) {
  return (
    <label className={styles.termPick}>
      <CalendarRange aria-hidden className={styles.termIcon} />
      <span className="sr-only">{t("termPick.label")}</span>
      <select className={styles.termSelect} value={choice ?? ""} onChange={(e) => onChoose(e.target.value || null)}>
        <option value="">{t("termPick.all")}</option>
        {terms.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className={styles.termChevron} />
    </label>
  );
}
