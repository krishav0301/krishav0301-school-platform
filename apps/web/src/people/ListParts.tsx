"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useId } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { Skeleton } from "@/ui";

import styles from "./people-access.module.css";

/**
 * The parts of a searched, filtered and paged list, shared by People & Access (D-099) and the Students page: a search
 * box, a labelled filter, the loading rows and the pager.
 */

export function SearchBox({ label, value, onChange }: { label: MessageKey; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.search}>
      <Search aria-hidden />
      <span className="sr-only">{t(label)}</span>
      <input type="search" value={value} placeholder={t(label)} maxLength={100} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: MessageKey;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.filter}>
      <label htmlFor={id} className={styles.filterLabel}>
        {t(label)}
      </label>
      <select id={id} className={styles.select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The shape of a list while it loads (D-030: never a lone spinner). */
export function ListSkeleton({ label }: { label: MessageKey }) {
  return (
    <div role="status" aria-busy="true" className={styles.skeletons}>
      <span className="sr-only">{t(label)}</span>
      {[0, 1, 2].map((n) => (
        <div key={n} className={styles.skeletonRow} aria-hidden>
          <Skeleton width="2.75rem" height="2.75rem" />
          <div className={styles.skeletonText}>
            <Skeleton width="40%" height="1.1rem" />
            <Skeleton width="60%" />
          </div>
          <Skeleton width="6rem" height="1.75rem" />
        </div>
      ))}
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage, noun }: { page: number; total: number; pageSize: number; onPage: (page: number) => void; noun: MessageKey }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={styles.pager}>
      <p className={styles.muted}>{t(noun, { from, to, total })}</p>
      {pages > 1 ? (
        <nav aria-label={t("content.pages")} className={styles.pages}>
          <button type="button" className={styles.pageButton} disabled={page <= 1} aria-label={t("content.prevPage")} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden />
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2)
            .map((n) => (
              <button key={n} type="button" className={styles.pageButton} aria-current={n === page ? "page" : undefined} aria-label={t("content.pageNumber", { page: n })} onClick={() => onPage(n)}>
                {n}
              </button>
            ))}
          <button type="button" className={styles.pageButton} disabled={page >= pages} aria-label={t("content.nextPage")} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
