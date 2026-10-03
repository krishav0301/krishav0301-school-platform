"use client";

import { CalendarDays, ChevronRight, Info, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { formatBsDate, isWholeBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Notice, Skeleton } from "@/ui";

import styles from "./ReadView.module.css";

/**
 * The pieces every "read the school" page is built from (D-103, after the PM's topic 7 reference): a calm header with
 * the day in BS, a row of figures, a card holding a table that becomes stacked rows on a phone, status said in words,
 * a quiet read-only note, and a "Change date" pop-up with the BS day picker. Nothing here writes.
 */

export { styles as readStyles };

export interface Crumb {
  label: string;
  href?: string;
}

export function ReadHeader({ title, subtitle, crumbs, dayBs, actions }: { title: string; subtitle?: string; crumbs?: Crumb[]; dayBs?: string | null; actions?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label={t("read.breadcrumb")}>
            <ol className={styles.crumbs}>
              {crumbs.map((c) => (
                <li key={c.label}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {dayBs || actions ? (
        <div className={styles.aside}>
          {dayBs ? <p className={styles.date}>{dayBs}</p> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** "Today · 17 Ashwin 2083", or the day shown when it is not today. */
export const dayLine = (dateBs: string | null, isToday: boolean, fallbackAd?: string): string => {
  const day = dateBs ? formatBsDate(dateBs) : (fallbackAd ?? "");
  return isToday ? t("read.today", { date: day }) : day;
};

export type Tone = "accent" | "ok" | "bad" | "warn";

export interface Figure {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  value: string;
  label: string;
}

/** At most four figures (D-103); only what the server already gives. */
export function FigureTiles({ figures, label }: { figures: readonly Figure[]; label: string }) {
  if (figures.length === 0) return null;
  return (
    <ul className={styles.tiles} aria-label={label}>
      {figures.slice(0, 4).map((f) => (
        <li key={f.key} className={styles.tile}>
          <span className={styles.tileIcon} data-tone={f.tone} aria-hidden>
            <f.icon strokeWidth={1.75} />
          </span>
          <span className={styles.tileText}>
            <span className={styles.tileValue}>{f.value}</span>
            <span className={styles.tileLabel}>{f.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Panel({ title, actions, children, labelledBy }: { title?: string; actions?: ReactNode; children: ReactNode; labelledBy?: string }) {
  return (
    <section className={styles.panel} aria-labelledby={title ? labelledBy : undefined}>
      {title || actions ? (
        <div className={styles.panelHead}>
          {title ? (
            <h2 id={labelledBy} className={styles.panelTitle}>
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  cell: (row: R, index: number) => ReactNode;
  align?: "start" | "end" | "center";
  /** The row's name: shown as the stacked row's heading on a phone. */
  primary?: boolean;
  /** No label before it on a phone (a link, a status that speaks for itself). */
  plain?: boolean;
  /** Left out on a phone (a row number). */
  hidePhone?: boolean;
}

/** A real table on a wide screen; on a phone each row stacks, every value with its column's name (D-103). */
export function ReadTable<R>({ caption, columns, rows, rowKey }: { caption: string; columns: readonly Column<R>[]; rows: readonly R[]; rowKey: (row: R) => string }) {
  return (
    <table className={styles.table}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" data-align={c.align} data-hide-phone={c.hidePhone || undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} data-label={c.label} data-align={c.align} data-primary={c.primary || undefined} data-plain={c.plain || undefined} data-hide-phone={c.hidePhone || undefined}>
                {c.cell(row, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A status said in words, in the theme's status colours (never the brand colour, D-030). */
export function StatusWord({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "bad" | "warn"; children: ReactNode }) {
  return (
    <span className={styles.status} data-tone={tone === "neutral" ? undefined : tone}>
      {children}
    </span>
  );
}

/** "Open →", a quiet link to the row's own page. The name read out says what it opens; `text` changes the visible word. */
export function OpenLink({ href, label, text }: { href: string; label: string; text?: string }) {
  return (
    <Link href={href} className={styles.rowLink} aria-label={label}>
      {text ?? t("read.open")}
      <ChevronRight aria-hidden />
    </Link>
  );
}

/** Said once, quietly: the Principal looks; someone else changes it. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p className={styles.readOnly}>
      <Info aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Two or three views of one page, as pressed buttons (Today's register / Year so far). */
export function Segments<K extends string>({ value, options, onChange, label }: { value: K; options: readonly { key: K; label: string }[]; onChange: (key: K) => void; label: string }) {
  return (
    <div className={styles.segments} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className={styles.segment} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "Change date": the BS day picker in a pop-up (D-103). A half-filled day asks for the rest (admin FUT F-19); a day
 * outside the verified calendar is refused by the server, which is the only place that knows the calendar.
 */
export function ChangeDate({ onDate, badDay = "attendance.class.badDay" }: { onDate: (ad: string) => void; badDay?: MessageKey }) {
  const { api } = useSession();
  const [bs, setBs] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AddDialog label={t("read.changeDate")} title={t("read.changeDateTitle")} variant="secondary" plus={false} icon={<CalendarDays aria-hidden width={18} height={18} />}>
      {(close) => (
        <form
          className={styles.datePick}
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (!isWholeBsDate(bs)) return setError("attendance.class.incompleteDay");
            setBusy(true);
            const result = await toAd(api, bs.trim());
            setBusy(false);
            if (!result.ok) return setError(badDay);
            setError(null);
            onDate(result.ad);
            close();
          }}
        >
          <BsDateField legend={t("read.day")} hint={t("read.dayHint")} error={error ? t(error) : undefined} value={bs} onChange={setBs} />
          <Button type="submit" loading={busy} loadingLabel={t("setup.working")}>
            {t("read.showDay")}
          </Button>
        </form>
      )}
    </AddDialog>
  );
}

/** The shape of a table while it loads (D-030): rows, not a lone spinner. */
export function TableSkeleton({ rows = 5, tiles = 0 }: { rows?: number; tiles?: number }) {
  return (
    <div role="status" aria-busy="true" className={styles.page}>
      <span className="sr-only">{t("setup.loading")}</span>
      {tiles > 0 ? (
        <div className={styles.tiles} aria-hidden>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className={styles.tile}>
              <Skeleton width="2.75rem" height="2.75rem" />
              <span className={styles.tileText}>
                <Skeleton width="4rem" height="1.25rem" />
                <Skeleton width="6rem" />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.panel} aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} width={`${90 - (i % 3) * 12}%`} height="1.25rem" />
        ))}
      </div>
    </div>
  );
}

/** "Couldn't load this." with Retry; or the one answer for another role's page (admin FUT F-14). */
export function ReadFailure({ status, onRetry }: { status: "failed" | "forbidden"; onRetry: () => void }) {
  if (status === "forbidden") return <Notice tone="bad">{t("setup.forbidden")}</Notice>;
  return (
    <Notice tone="bad">
      <span className={styles.failed}>
        {t("read.loadFailed")}
        <Button variant="secondary" onClick={onRetry}>
          {t("read.retry")}
        </Button>
      </span>
    </Notice>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
