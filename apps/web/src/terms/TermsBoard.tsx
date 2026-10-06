"use client";

import { ArrowRight, CalendarDays, GraduationCap, Info, Layers, School, UsersRound } from "lucide-react";
import { useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { FilterSelect, SearchBox } from "@/people/ListParts";
import accessStyles from "@/people/people-access.module.css";
import { StatusWord } from "@/read/ReadView";
import { Button, RowMenu, type MenuAction } from "@/ui";

import { TERM_STATUS, levelChips, otherTerms, termDates, termTiming, termWings, type OtherStatus, type Term } from "./model";
import styles from "./terms.module.css";

/** What the side panel opens on: its overview, or straight on one of its steps (from a menu). */
export type TermStart = "view" | "edit" | "next" | "close" | "open";
export type Manage = (term: Term, start: TermStart) => void;

/** Each active card's tint, in turn, from the theme's tones. */
const TONES = ["primary", "ok", "accent", "warn"] as const;

/** The page's note on what a term is (the PM's banner, 2026-10-06). Pure. */
export function TermsBanner() {
  return (
    <p className={styles.banner}>
      <Info aria-hidden />
      <span>{t("terms.banner")}</span>
    </p>
  );
}

/** The menu's actions for a term, by where it stands; each opens the side panel on that step. Pure. */
export function termActions(term: Term, manage: Manage): MenuAction[] {
  if (term.status === "active")
    return [
      { key: "levels", label: t("terms.menu.levels"), onSelect: () => manage(term, "edit") },
      { key: "next", label: t("terms.menu.next"), onSelect: () => manage(term, "next") },
      { key: "close", label: t("terms.menu.close"), onSelect: () => manage(term, "close") },
    ];
  if (term.status === "draft")
    return [
      { key: "edit", label: t("terms.menu.edit"), onSelect: () => manage(term, "edit") },
      { key: "open", label: t("terms.menu.open"), onSelect: () => manage(term, "open") },
    ];
  return [{ key: "next", label: t("terms.menu.next"), onSelect: () => manage(term, "next") }];
}

function Chips({ term }: { term: Term }) {
  const { chips, more } = levelChips(term);
  if (chips.length === 0) return <span className={styles.meta}>{t("terms.noLevelsShort")}</span>;
  return (
    <ul className={styles.chips} aria-label={t("terms.appliesTo")}>
      {chips.map((chip) => (
        <li key={chip} className={styles.chip}>
          {chip}
        </li>
      ))}
      {more > 0 ? <li className={styles.chip}>{t("terms.chipsMore", { n: more })}</li> : null}
    </ul>
  );
}

/** Currently Active: one card per active term, and nothing else (the PM). Pure. */
export function ActiveTerms({ terms, today, manage }: { terms: readonly Term[]; today: string; manage?: Manage }) {
  const { config } = useConfig();
  const sections = config?.sections ?? [];
  const active = terms.filter((x) => x.status === "active");
  return (
    <section className={styles.board} aria-labelledby="active-terms">
      <div>
        <h2 id="active-terms" className={styles.boardTitle}>
          <span className={styles.liveDot} aria-hidden />
          {t("terms.active.title", { n: active.length })}
        </h2>
        <p className={styles.meta}>{t("terms.active.intro")}</p>
      </div>
      {active.length === 0 ? <p className={styles.meta}>{t("terms.active.none")}</p> : null}
      <ul className={styles.cards}>
        {active.map((term, i) => (
          <li key={term.id} className={styles.card} data-tone={TONES[i % TONES.length]}>
            <div className={styles.cardTop}>
              <span className={accessStyles.tile} data-tone={TONES[i % TONES.length]} aria-hidden>
                <GraduationCap />
              </span>
              <StatusWord tone={TERM_STATUS.active.tone}>{t(TERM_STATUS.active.key)}</StatusWord>
              {manage ? <RowMenu label={t("terms.menu", { name: term.label })} actions={termActions(term, manage)} /> : null}
            </div>
            <div>
              <h3 className={styles.cardTitle}>{term.label}</h3>
              <p className={styles.meta}>{termWings(term, sections).join(" · ")}</p>
            </div>
            <p className={styles.line}>
              <CalendarDays aria-hidden />
              <span>
                {termDates(term)}
                <span className={styles.meta}>{termTiming(term, today)}</span>
              </span>
            </p>
            <div className={styles.line}>
              <Layers aria-hidden />
              <span>
                <span className={styles.meta}>{t("terms.appliesTo")}</span>
                <Chips term={term} />
              </span>
            </div>
            <dl className={styles.counts}>
              <div>
                <dt>
                  <School aria-hidden />
                  {t("terms.stat.classes")}
                </dt>
                <dd>{term.classes}</dd>
              </div>
              <div>
                <dt>
                  <UsersRound aria-hidden />
                  {t("terms.stat.students")}
                </dt>
                <dd>{term.students}</dd>
              </div>
            </dl>
            {manage ? (
              <Button variant="secondary" className={styles.manage} onClick={() => manage(term, "view")} aria-label={t("terms.manageNamed", { name: term.label })}>
                {t("terms.manageTerm")}
                <ArrowRight aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Other Terms: every term that is not active, searched and filtered by status (the PM). */
export function OtherTerms({ terms, today, manage }: { terms: readonly Term[]; today: string; manage?: Manage }) {
  const { config } = useConfig();
  const sections = config?.sections ?? [];
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OtherStatus>("");
  const rows = otherTerms(terms, q, status);
  const any = terms.some((x) => x.status !== "active");
  return (
    <section className={styles.board} aria-labelledby="other-terms">
      <div className={styles.boardHead}>
        <div>
          <h2 id="other-terms" className={styles.boardTitle}>
            {t("terms.other.title")}
          </h2>
          <p className={styles.meta}>{t("terms.other.intro")}</p>
        </div>
        {any ? (
          <div className={styles.tools}>
            <SearchBox label="terms.search" value={q} onChange={setQ} />
            <FilterSelect
              label="content.filterState"
              value={status}
              onChange={(v) => setStatus(v as OtherStatus)}
              options={[
                { value: "", label: t("content.filterAll") },
                { value: "draft", label: t(TERM_STATUS.draft.key) },
                { value: "closed", label: t(TERM_STATUS.closed.key) },
              ]}
            />
          </div>
        ) : null}
      </div>
      {!any ? <p className={styles.meta}>{t("terms.other.none")}</p> : rows.length === 0 ? <p className={styles.meta}>{t("terms.other.noneFound")}</p> : null}
      {rows.length > 0 ? (
        <table className={accessStyles.table}>
          <thead>
            <tr>
              <th scope="col">{t("terms.col.term")}</th>
              <th scope="col">{t("terms.col.period")}</th>
              <th scope="col">{t("terms.col.appliesTo")}</th>
              <th scope="col">{t("terms.stat.classes")}</th>
              <th scope="col">{t("terms.stat.students")}</th>
              <th scope="col">{t("terms.col.status")}</th>
              <th scope="col">
                <span className="sr-only">{t("terms.col.action")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((term) => (
              <tr key={term.id}>
                <td className={accessStyles.nameCell}>
                  <span className={accessStyles.personName}>{term.label}</span>
                  <span className={styles.meta}>{termWings(term, sections).join(" · ") || t("terms.receiptCode", { code: term.code })}</span>
                </td>
                <td data-label={t("terms.col.period")}>
                  <span className={accessStyles.cellMain}>{termDates(term)}</span>
                  <span className={styles.meta}>{termTiming(term, today)}</span>
                </td>
                <td data-label={t("terms.col.appliesTo")}>
                  <Chips term={term} />
                </td>
                <td data-label={t("terms.stat.classes")}>{term.classes}</td>
                <td data-label={t("terms.stat.students")}>{term.students}</td>
                <td data-label={t("terms.col.status")}>
                  <StatusWord tone={TERM_STATUS[term.status].tone}>{t(TERM_STATUS[term.status].key)}</StatusWord>
                </td>
                <td className={accessStyles.actionsCell}>
                  {manage ? (
                    <span className={styles.rowActions}>
                      <Button variant="quiet" onClick={() => manage(term, "view")} aria-label={t(term.status === "closed" ? "terms.viewNamed" : "terms.manageNamed", { name: term.label })}>
                        {t(term.status === "closed" ? "terms.view" : "terms.manage")}
                      </Button>
                      <RowMenu label={t("terms.menu", { name: term.label })} actions={termActions(term, manage)} />
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
